/** Geometry for turning drawn strokes into an image the HMER model was
 *  trained on.
 *
 *  The model never saw screenshots of a canvas. It saw CROHME renders:
 *  binary black-on-white, cropped to the ink with no margin, strokes a
 *  near-constant ~22 px wide (measured on the training set — design spec
 *  docs/superpowers/specs/2026-09-23-hmer-attention-and-ink-canvas-design.md
 *  §2.4). Strokes are therefore kept as vectors and re-rendered at export
 *  rather than copying the on-screen canvas, whose margins and screen-sized
 *  strokes are exactly what the model is not used to.
 *
 *  This module is the pure half: where the ink is and how big the image must
 *  be. Rasterising lives with the component, since it needs a real canvas. */

export interface InkPoint {
  x: number;
  y: number;
}

/** One pen-down to pen-up, in CSS px of the drawing surface. */
export type InkStroke = InkPoint[];

/** On-screen pen width, CSS px. Fixed, and pressure is ignored: training
 *  strokes have constant width, so varying it would only add a difference. */
export const PEN_PX = 4;

/** Median training stroke width after rendering (IQR 16–24 px, spec §2.4).
 *  Exported strokes are scaled to this. With PEN_PX = 4 a line written 60 px
 *  tall comes out ~330 px tall, close to the training median of 373. */
export const TRAIN_STROKE_PX = 22;

/** Longest side allowed in the exported image — about the widest training
 *  image (2181 px). Past it the whole drawing shrinks uniformly, strokes
 *  included; a thinner stroke is a smaller departure from training data than
 *  an image larger than any the model has seen. */
export const MAX_EXPORT_PX = 2200;

export interface ExportLayout {
  /** Output image size in px, rounded for a canvas. */
  width: number;
  height: number;
  /** CSS px → output px. */
  scale: number;
  /** Subtracted from a point before scaling: the top-left of the ink box. */
  offsetX: number;
  offsetY: number;
  /** Stroke width in output px — TRAIN_STROKE_PX unless the cap shrank it. */
  strokeWidth: number;
}

/** Where to draw, and at what size, so the export looks like training data.
 *  Returns null when there is no ink at all. */
export function exportLayout(strokes: InkStroke[], penPx: number = PEN_PX): ExportLayout | null {
  // One loop rather than Math.min(...points): pointer events arrive at up to
  // 120 Hz, and spreading a long drawing into call arguments can overflow
  // the engine's argument limit.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of strokes) {
    for (const p of stroke) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (minX === Infinity) return null;

  // The box must hold the stroke's *edges*, not just the points it passes
  // through, or the outermost strokes are clipped in half. Expanding by half
  // the pen is also what leaves zero margin: training crops touch the ink.
  const half = penPx / 2;
  minX -= half;
  minY -= half;
  const boxW = maxX + half - minX;
  const boxH = maxY + half - minY;

  const scale = Math.min(TRAIN_STROKE_PX / penPx, MAX_EXPORT_PX / Math.max(boxW, boxH));

  return {
    width: Math.max(1, Math.round(boxW * scale)),
    height: Math.max(1, Math.round(boxH * scale)),
    scale,
    offsetX: minX,
    offsetY: minY,
    strokeWidth: penPx * scale,
  };
}
