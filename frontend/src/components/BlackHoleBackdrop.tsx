import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { BlackHoleHandle } from "../three/blackhole";
import { LENS, MIN_VISIBLE_W, REF_H } from "../three/blackhole/config.js";

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

/** Thấu kính bẻ cong được CẢ GIAO DIỆN (ô nhập, thẻ gợi ý, sidebar...) chứ không
 *  riêng nền: một đĩa trong suốt đi theo con trỏ, mang backdrop-filter trỏ tới
 *  một bộ lọc SVG feDisplacementMap. Chỉ Chromium nhận bộ lọc SVG trong
 *  backdrop-filter; trình duyệt khác rơi về thấu kính vẽ trong canvas (setLens),
 *  chỉ bẻ cong nền. */
const DOM_LENS_SUPPORTED =
  typeof CSS !== "undefined" && typeof CSS.supports === "function" &&
  CSS.supports("backdrop-filter", "url(#x)") &&
  /Chrome\//.test(navigator.userAgent) &&
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const SVG_NS = "http://www.w3.org/2000/svg";
/** Bán kính đĩa thấu kính tính theo bán kính Einstein. Độ lệch giảm như θE²/d
 *  nên không bao giờ về 0 — phải ép về 0 dần từ LENS_FADE_FROM × bán kính đĩa,
 *  không thì mép đĩa lộ thành một đường gãy. */
const LENS_DISC = 4.5;
const LENS_FADE_FROM = 0.5;
const LENS_MAP_PX = 256;

/** Bản đồ dịch chuyển của thấu kính: điểm ảnh cách tâm d lấy mẫu ở
 *  d − θE²·d / (|d|² + mềm²) — cùng phương trình với lượt bẻ cong trong canvas
 *  (index.ts). feDisplacementMap đọc độ lệch từ kênh R (x) và G (y), 0.5 = đứng
 *  yên, nhân với `scale`. Trả về ảnh PNG và `scale` tương ứng (px CSS). */
function buildLensMap(thetaE: number, soft: number, radius: number): { url: string; scale: number } {
  const n = LENS_MAP_PX;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = n;
  const ctx = canvas.getContext("2d");
  const scale = (thetaE * thetaE) / soft; // 2 × độ lệch lớn nhất (đạt ở |d| = mềm)
  if (!ctx) return { url: "", scale };
  const img = ctx.createImageData(n, n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const dx = ((i + 0.5) / n - 0.5) * 2 * radius;
      const dy = ((j + 0.5) / n - 0.5) * 2 * radius;
      const d2 = dx * dx + dy * dy;
      const t = Math.min(1, Math.max(0, (Math.sqrt(d2) / radius - LENS_FADE_FROM) / (1 - LENS_FADE_FROM)));
      const k = (-(thetaE * thetaE) / (d2 + soft * soft)) * (1 - t * t * (3 - 2 * t));
      const o = (j * n + i) * 4;
      img.data[o] = Math.round(255 * (0.5 + (k * dx) / scale));
      img.data[o + 1] = Math.round(255 * (0.5 + (k * dy) / scale));
      img.data[o + 2] = 128;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { url: canvas.toDataURL("image/png"), scale };
}

function useCursorLens(active: boolean, anchorRef: RefObject<HTMLElement>) {
  useEffect(() => {
    const anchorEl = anchorRef.current;
    if (!active || !anchorEl) return;

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.setAttribute("aria-hidden", "true");
    svg.style.position = "absolute";
    const filter = document.createElementNS(SVG_NS, "filter");
    filter.id = "bh-lens-filter";
    filter.setAttribute("filterUnits", "userSpaceOnUse");
    // giá trị kênh màu của bản đồ là độ lệch thô — không được đổi qua linearRGB
    filter.setAttribute("color-interpolation-filters", "sRGB");
    const image = document.createElementNS(SVG_NS, "feImage");
    image.setAttribute("preserveAspectRatio", "none");
    image.setAttribute("result", "map");
    const displace = document.createElementNS(SVG_NS, "feDisplacementMap");
    displace.setAttribute("in", "SourceGraphic");
    displace.setAttribute("in2", "map");
    displace.setAttribute("xChannelSelector", "R");
    displace.setAttribute("yChannelSelector", "G");
    filter.append(image, displace);
    svg.append(filter);

    const disc = document.createElement("div");
    disc.className = "bh-lens";
    disc.setAttribute("aria-hidden", "true");
    document.body.append(svg, disc);

    // cỡ thấu kính đi theo cỡ hố đen (cùng công thức scale với index.ts)
    let radius = 0;
    const build = () => {
      const r = anchorEl.getBoundingClientRect();
      const unit = Math.min(r.height / REF_H, r.width / MIN_VISIBLE_W);
      const next = Math.round(LENS.radius * unit * LENS_DISC);
      if (next === radius || next < 8) return;
      radius = next;
      const map = buildLensMap(LENS.radius * unit, LENS.soft * unit, radius);
      const size = String(2 * radius);
      for (const el of [filter, image]) {
        el.setAttribute("x", "0");
        el.setAttribute("y", "0");
        el.setAttribute("width", size);
        el.setAttribute("height", size);
      }
      image.setAttribute("href", map.url);
      displace.setAttribute("scale", String(map.scale));
      disc.style.width = disc.style.height = `${size}px`;
    };
    build();
    const observer = new ResizeObserver(build);
    observer.observe(anchorEl);

    const onMove = (e: PointerEvent) => {
      disc.style.transform = `translate3d(${e.clientX - radius}px, ${e.clientY - radius}px, 0)`;
      disc.classList.add("on");
    };
    const onGone = () => disc.classList.remove("on");
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onGone);
    window.addEventListener("blur", onGone);

    return () => {
      observer.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onGone);
      window.removeEventListener("blur", onGone);
      svg.remove();
      disc.remove();
    };
  }, [active, anchorRef]);
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
export function BlackHoleBackdrop({ anchorRef, lens = false }: {
  anchorRef: RefObject<HTMLElement>;
  /** Thấu kính hấp dẫn quanh con trỏ: mọi thứ bị bẻ cong quanh chỗ chuột trỏ tới
   *  (trình duyệt không phải Chromium: chỉ nền). */
  lens?: boolean;
}) {
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

  // Tách khỏi effect trên: bật / tắt thấu kính không được dựng lại neo. Đọc
  // `shared` trực tiếp vì handle có thể chưa nạp xong lúc effect này chạy —
  // khi đó sự kiện bh-ready áp lại.
  useEffect(() => {
    if (!dark) return;
    const apply = () => shared?.handle?.setLens(lens && !DOM_LENS_SUPPORTED);
    apply();
    const canvas = shared?.canvas;
    canvas?.addEventListener("bh-ready", apply);
    return () => {
      canvas?.removeEventListener("bh-ready", apply);
      shared?.handle?.setLens(false);
    };
  }, [dark, lens]);

  useCursorLens(dark && lens && DOM_LENS_SUPPORTED, anchorRef);

  if (!dark) return null;
  return <div ref={hostRef} className="bh-backdrop" aria-hidden="true" />;
}
