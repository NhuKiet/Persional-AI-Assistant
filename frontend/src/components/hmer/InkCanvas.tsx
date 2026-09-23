import { useCallback, useEffect, useRef, useState } from "react";
import { PEN_PX, exportLayout, type InkPoint, type InkStroke } from "../../lib/hmerInk";

/* Black on a white pad whatever the theme: the pad stands for paper, and the
   export must be black on white like the training images. */
const INK = "#000";
const PAPER = "#fff";

/** Paints strokes in the context's current coordinate space. Shared by the
 *  preview and the export, so the model is sent what the user saw. */
function drawStrokes(ctx: CanvasRenderingContext2D, strokes: InkStroke[], penPx: number) {
  ctx.lineWidth = penPx;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  for (const stroke of strokes) {
    if (stroke.length === 0) continue;
    ctx.beginPath();
    if (stroke.length === 1) {
      // A tap is real ink here (the dot on an i, a decimal point), and a
      // zero-length line with round caps is not painted reliably everywhere.
      ctx.arc(stroke[0].x, stroke[0].y, penPx / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.moveTo(stroke[0].x, stroke[0].y);
    for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x, stroke[i].y);
    ctx.stroke();
  }
}

/** Re-renders the strokes the way training images look (design spec §5.2):
 *  cropped to the ink, 22 px strokes, black on white, binarised. */
export async function renderInkImage(strokes: InkStroke[]): Promise<File | null> {
  const layout = exportLayout(strokes);
  if (!layout) return null;

  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("trình duyệt không cho vẽ lên canvas");

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, layout.width, layout.height);
  // lineWidth is in these scaled units too, so PEN_PX comes out as
  // layout.strokeWidth without drawing code knowing about export sizes.
  ctx.setTransform(
    layout.scale, 0, 0, layout.scale,
    -layout.offsetX * layout.scale, -layout.offsetY * layout.scale,
  );
  drawStrokes(ctx, strokes, PEN_PX);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Canvas antialiasing cannot be switched off, and training images have
  // exactly two grey levels.
  const image = ctx.getImageData(0, 0, layout.width, layout.height);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    const v = px[i] + px[i + 1] + px[i + 2] < 3 * 128 ? 0 : 255;
    px[i] = v;
    px[i + 1] = v;
    px[i + 2] = v;
    px[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("không tạo được ảnh PNG");
  return new File([blob], "ve-tay.png", { type: "image/png" });
}

interface InkCanvasProps {
  busy: boolean;
  onSubmit: (file: File) => void;
  /** Injectable because jsdom has no canvas rasteriser. */
  exportImage?: (strokes: InkStroke[]) => Promise<File | null>;
}

/** Draw one expression with mouse, pen or finger; submit it as an image.
 *
 *  Strokes are kept as vectors, not read back from this canvas: the on-screen
 *  pad has margins and screen-sized strokes, which is not what the model was
 *  trained on. The export re-renders them (renderInkImage). */
export function InkCanvas({ busy, onSubmit, exportImage = renderInkImage }: InkCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<InkStroke[]>([]);
  // The stroke being drawn lives in a ref: pointermove fires up to 120 times
  // a second, and re-rendering React on each one makes the pen lag.
  const live = useRef<{ pointerId: number; stroke: InkStroke } | null>(null);
  const [penDown, setPenDown] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  const context = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return null;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }, []);

  const repaint = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = context();
    if (!canvas || !ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    context();
    drawStrokes(ctx, live.current ? [...strokes, live.current.stroke] : strokes, PEN_PX);
  }, [context, strokes]);

  const repaintRef = useRef(repaint);
  repaintRef.current = repaint;

  useEffect(() => {
    repaint();
  }, [repaint]);

  // The backing store follows CSS size × devicePixelRatio, or the preview is
  // blurry on HiDPI screens. Resizing a canvas clears it, hence the repaint.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      repaintRef.current();
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const pointsOf = (e: React.PointerEvent<HTMLCanvasElement>): InkPoint[] => {
    const rect = e.currentTarget.getBoundingClientRect();
    // Coalesced events carry the samples the browser merged into this one;
    // without them fast strokes turn into visible polygons.
    const native = e.nativeEvent as PointerEvent;
    const coalesced = native.getCoalescedEvents?.() ?? [];
    const samples = coalesced.length > 0 ? coalesced : [native];
    return samples.map((s) => ({ x: s.clientX - rect.left, y: s.clientY - rect.top }));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // One pen at a time: a second finger or a resting palm must not add ink.
    if (live.current) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    try {
      // Keep receiving moves when the pen strays past the pad's edge.
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // Synthetic or already-released pointers cannot be captured; drawing
      // still works, it just stops at the edge.
    }
    const [point] = pointsOf(e);
    live.current = { pointerId: e.pointerId, stroke: [point] };
    setPenDown(true);
    setError("");
    const ctx = context();
    if (ctx) drawStrokes(ctx, [[point]], PEN_PX);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const current = live.current;
    if (!current || e.pointerId !== current.pointerId) return;
    const ctx = context();
    for (const point of pointsOf(e)) {
      const previous = current.stroke[current.stroke.length - 1];
      current.stroke.push(point);
      if (ctx) drawStrokes(ctx, [[previous, point]], PEN_PX);
    }
  };

  const endStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const current = live.current;
    if (!current || e.pointerId !== current.pointerId) return;
    live.current = null;
    setPenDown(false);
    // Kept on pointercancel too: the ink is already on screen, and silently
    // dropping it would look like a bug.
    setStrokes((prev) => [...prev, current.stroke]);
  };

  const submit = async () => {
    if (strokes.length === 0 || busy || exporting) return;
    setExporting(true);
    setError("");
    try {
      const file = await exportImage(strokes);
      if (file) onSubmit(file);
    } catch (err) {
      setError(`Không xuất được ảnh từ nét vẽ: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(false);
    }
  };

  const empty = strokes.length === 0;

  return (
    <div className="hmer-ink">
      <div className="hmer-ink-pad-wrap">
        <canvas
          ref={canvasRef}
          className="hmer-ink-pad"
          aria-label="Khung vẽ công thức — dùng chuột, bút hoặc ngón tay"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onLostPointerCapture={endStroke}
        />
        {empty && !penDown && (
          <span className="hmer-ink-hint" aria-hidden="true">
            Viết công thức ở đây
          </span>
        )}
      </div>

      <div className="hmer-ink-actions">
        <button
          type="button"
          className="hmer-btn"
          onClick={() => setStrokes((prev) => prev.slice(0, -1))}
          disabled={empty}
        >
          Hoàn tác
        </button>
        <button type="button" className="hmer-btn" onClick={() => setStrokes([])} disabled={empty}>
          Xoá
        </button>
        <button
          type="button"
          className="hmer-btn hmer-btn-primary"
          onClick={() => void submit()}
          disabled={empty || busy || exporting}
        >
          {(busy || exporting) && <span className="hmer-spinner" aria-hidden="true" />}
          Nhận dạng
        </button>
        {/* Stroke width is fixed, so writing size sets the stroke-to-symbol
            ratio the model sees. About a third of the pad keeps it near the
            training data's. */}
        <span className="hmer-ink-note">Một biểu thức, cao khoảng một phần ba khung.</span>
      </div>

      {error && (
        <p className="hmer-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export default InkCanvas;
