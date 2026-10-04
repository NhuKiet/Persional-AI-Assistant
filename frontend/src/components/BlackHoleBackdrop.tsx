import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { BlackHoleHandle } from "../three/blackhole";

/** Tâm hố đen nằm chính giữa vùng nội dung (tỉ lệ theo bề ngang / bề cao của
 *  phần tử neo). Cỡ hố co giãn theo chính vùng đó (xem setAnchor), nên đổi độ
 *  phân giải hay thu gọn sidebar thì hố vừa trượt về tâm mới vừa to / nhỏ theo.
 *  Nội dung trang nằm đè lên hố, nên canvas được làm mờ — xem .bh-canvas trong
 *  coding.css. */
const ANCHOR = { x: 0.5, y: 0.5 };

/** Cảnh WebGL dùng chung cho mọi trang có nền hố đen. Shader ray-march biên
 *  dịch mất cỡ một giây (ANGLE/D3D trên Windows), nên không dựng lại mỗi lần
 *  đổi route: canvas được chuyển sang host của trang mới, context giữ nguyên.
 *  Chỉ huỷ khi không còn trang nào dùng sau DISPOSE_AFTER_MS. */
const DISPOSE_AFTER_MS = 4000;
interface Shared {
  canvas: HTMLCanvasElement;
  handle: BlackHoleHandle | null;
  users: number;
  disposeTimer: number;
  failed: boolean;
}
let shared: Shared | null = null;

function acquire(): Shared {
  if (shared) {
    window.clearTimeout(shared.disposeTimer);
    shared.users++;
    return shared;
  }
  const canvas = document.createElement("canvas");
  canvas.className = "bh-canvas";
  canvas.setAttribute("aria-hidden", "true");
  const s: Shared = { canvas, handle: null, users: 1, disposeTimer: 0, failed: false };
  shared = s;
  const fail = (err: unknown) => {
    console.warn("[blackhole] không dựng được nền WebGL, dùng nền tĩnh", err);
    s.failed = true;
    canvas.remove();
  };
  // three.js chỉ nạp khi thật sự cần nền này (theme tối, trang có AppShell)
  import("../three/blackhole")
    .then(({ createBlackHoleBackdrop }) => {
      if (shared !== s) return;
      s.handle = createBlackHoleBackdrop(canvas, { onFail: fail });
      if (!s.failed) canvas.classList.add("ready");
      canvas.dispatchEvent(new Event("bh-ready"));
    })
    .catch(fail);
  return s;
}

function release(s: Shared) {
  s.users--;
  if (s.users > 0) return;
  s.disposeTimer = window.setTimeout(() => {
    if (s.users > 0) return;
    s.handle?.dispose();
    s.canvas.remove();
    if (shared === s) shared = null;
  }, DISPOSE_AFTER_MS);
}

/** Theme hiện tại đọc từ <html data-theme>. Không dùng useTheme(): mỗi lần gọi
 *  hook đó giữ state riêng, nên nút đổi theme trong Sidebar không báo được cho
 *  thành phần khác — thuộc tính trên <html> mới là nguồn chung. */
function useIsDark(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === "dark");
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setDark(root.dataset.theme === "dark"));
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/** Nền hố đen + sao phủ kín viewport, nằm sau toàn bộ giao diện kính. Chỉ có ở
 *  theme tối: theme sáng "Mist" là kính trắng với chữ tối, đặt lên nền trời đen
 *  thì không đọc được. `anchorRef` là vùng nội dung (app-main) — hố đen được
 *  neo theo nó nên tự trượt theo khi sidebar mở / đóng. */
export function BlackHoleBackdrop({ anchorRef }: { anchorRef: RefObject<HTMLElement> }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const dark = useIsDark();

  useEffect(() => {
    const host = hostRef.current;
    const anchorEl = anchorRef.current;
    if (!dark || !host || !anchorEl) return;

    const s = acquire();
    if (s.failed) { release(s); return; }
    host.appendChild(s.canvas);

    const place = () => {
      const r = anchorEl.getBoundingClientRect();
      s.handle?.setAnchor(r.left + r.width * ANCHOR.x, r.top + r.height * ANCHOR.y, r.width, r.height);
    };
    place();
    s.canvas.addEventListener("bh-ready", place);
    const observer = new ResizeObserver(place);
    observer.observe(anchorEl);
    window.addEventListener("resize", place);

    return () => {
      s.canvas.removeEventListener("bh-ready", place);
      observer.disconnect();
      window.removeEventListener("resize", place);
      release(s);
    };
  }, [dark, anchorRef]);

  if (!dark) return null;
  return <div ref={hostRef} className="bh-backdrop" aria-hidden="true" />;
}
