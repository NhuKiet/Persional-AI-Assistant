import { useRef, useState, useCallback, type ReactNode } from "react";
import SelectionToolbar, { type ToolbarPos } from "./SelectionToolbar";

const MAX_EDGE = 1568;

export type Pin =
  | { type: "text"; page: number; text: string }
  | { type: "image"; page: number; data_url: string };

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DragState {
  page: number;
  startX: number;
  startY: number;
}

interface ToolbarState {
  pos: ToolbarPos;
  pin: Pin;
}

// Crop 1 vùng của canvas trang → JPEG dataURL (giới hạn cạnh + nén)
function cropCanvas(canvas: HTMLCanvasElement, rect: CropRect): string {
  const ratio = canvas.width / canvas.clientWidth;      // canvas nội bộ vs hiển thị
  const sx = rect.x * ratio, sy = rect.y * ratio;
  const sw = rect.w * ratio, sh = rect.h * ratio;
  let dw = sw, dh = sh;
  const longEdge = Math.max(dw, dh);
  if (longEdge > MAX_EDGE) { const k = MAX_EDGE / longEdge; dw *= k; dh *= k; }
  const out = document.createElement("canvas");
  out.width = Math.round(dw); out.height = Math.round(dh);
  out.getContext("2d")!.drawImage(canvas, sx, sy, sw, sh, 0, 0, dw, dh);
  return out.toDataURL("image/jpeg", 0.85);
}

interface SelectionLayerProps {
  canvases: Map<number, HTMLCanvasElement>;
  onPin: (pin: Pin, action: string) => void;
  children: ReactNode;
}

export default function SelectionLayer({ canvases, onPin, children }: SelectionLayerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [toolbar, setToolbar] = useState<ToolbarState | null>(null);
  const drag = useRef<DragState | null>(null);
  const [box, setBox] = useState<CropRect | null>(null);            // rectangle overlay hiển thị
  const justCropped = useRef(false);                // true ngay sau khi vừa xử lý crop ảnh

  const pageAt = (target: EventTarget | null): number | null => {
    const el = target as HTMLElement | null;
    const wrap = el?.closest?.("[data-page-number]");
    return wrap ? Number((wrap as HTMLElement).dataset.pageNumber) : null;
  };

  /** Ẩn mọi overlay: toolbar + khung crop. */
  const clearOverlay = useCallback(() => { setToolbar(null); setBox(null); }, []);

  /** Vị trí toolbar tính theo VÙNG CHỌN, không theo con trỏ — neo vào cạnh dưới,
   *  căn giữa, để toolbar không đè lên chính phần vừa chọn. Toạ độ trả về là
   *  host-relative (host là positioned parent của toolbar). */
  const anchorBelow = useCallback((rect: DOMRect): ToolbarPos => {
    const host = hostRef.current!.getBoundingClientRect();
    return { x: rect.left + rect.width / 2 - host.left, y: rect.bottom - host.top };
  }, []);

  // ── Bôi đen text ──
  const onMouseUp = useCallback((e: React.MouseEvent) => {
    if (justCropped.current) { justCropped.current = false; return; } // vừa xử lý crop ảnh xong, bỏ qua
    if (drag.current) return; // đang crop ảnh, xử lý ở handler crop
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    // Bỏ bôi đen (click ra chỗ khác) => phải ẩn toolbar, nếu không nó nằm lại
    // mãi vì lần mouseup này không còn selection để dựng lại vị trí.
    if (!text) { clearOverlay(); return; }
    setBox(null); // chọn text thì bỏ khung ảnh cũ
    const page = pageAt(e.target) || 1;
    const rect = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
    const host = hostRef.current!.getBoundingClientRect();
    setToolbar({
      // Không lấy được rect (selection lạ) thì lùi về vị trí con trỏ.
      pos: rect && rect.width
        ? anchorBelow(rect)
        : { x: e.clientX - host.left, y: e.clientY - host.top },
      pin: { type: "text", page, text },
    });
  }, [anchorBelow, clearOverlay]);

  // ── Alt + kéo = khung ảnh ──
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!e.altKey) return;
    e.preventDefault();
    const page = pageAt(e.target);
    if (!page) return;
    clearOverlay(); // bắt đầu khung mới => bỏ khung/toolbar của lần trước
    const host = hostRef.current!.getBoundingClientRect();
    drag.current = { page, startX: e.clientX - host.left, startY: e.clientY - host.top };
  }, [clearOverlay]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!drag.current) return;
    const host = hostRef.current!.getBoundingClientRect();
    const x = e.clientX - host.left, y = e.clientY - host.top;
    const { startX, startY } = drag.current;
    setBox({ x: Math.min(x, startX), y: Math.min(y, startY), w: Math.abs(x - startX), h: Math.abs(y - startY) });
  }, []);

  const onMouseUpCrop = useCallback((e: React.MouseEvent) => {
    if (!drag.current) return;
    justCropped.current = true;
    const d = drag.current; drag.current = null;
    const b = box;
    // GIỮ khung sau khi thả chuột để người dùng còn thấy vùng mình vừa cắt;
    // khung chỉ biến mất khi toolbar đóng (chọn hành động / bấm ✕ / chọn cái khác).
    if (!b || b.w < 8 || b.h < 8) { setBox(null); return; }  // khung quá nhỏ → bỏ
    const canvas = canvases.get(d.page);
    if (!canvas) { setBox(null); return; }
    // đổi tọa độ host → tọa độ trong wrapper trang
    const wrap = hostRef.current!.querySelector(`[data-page-number="${d.page}"]`)!;
    const wrapRect = wrap.getBoundingClientRect();
    const hostRect = hostRef.current!.getBoundingClientRect();
    const rect: CropRect = {
      x: b.x - (wrapRect.left - hostRect.left),
      y: b.y - (wrapRect.top - hostRect.top),
      w: b.w, h: b.h,
    };
    const data_url = cropCanvas(canvas, rect);
    window.getSelection()?.removeAllRanges();
    setToolbar({
      // neo dưới khung vừa vẽ (toạ độ box đã là host-relative), không theo con trỏ
      pos: { x: b.x + b.w / 2, y: b.y + b.h },
      pin: { type: "image", page: d.page, data_url },
    });
  }, [box, canvases]);

  const handleAction = (action: string) => {
    if (!toolbar) return;
    const pin = toolbar.pin;
    clearOverlay();
    onPin(pin, action);      // action điều khiển gửi luôn hay chỉ ghim (Task 5)
  };

  return (
    <div
      ref={hostRef}
      className="selection-host"
      style={{ position: "relative" }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={(e) => { onMouseUpCrop(e); onMouseUp(e); }}
    >
      {children}
      {box && (
        <div
          className={`crop-box ${drag.current ? "" : "crop-box-done"}`}
          style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        />
      )}
      <SelectionToolbar pos={toolbar?.pos} onAction={handleAction} onClose={clearOverlay} />
    </div>
  );
}
