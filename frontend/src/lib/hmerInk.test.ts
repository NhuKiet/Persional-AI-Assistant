import { describe, expect, it } from "vitest";
import {
  MAX_EXPORT_PX,
  PEN_PX,
  TRAIN_STROKE_PX,
  exportLayout,
  type InkStroke,
} from "./hmerInk";

const line = (x0: number, y0: number, x1: number, y1: number): InkStroke => [
  { x: x0, y: y0 },
  { x: x1, y: y1 },
];

describe("exportLayout", () => {
  it("returns null when nothing was drawn", () => {
    expect(exportLayout([])).toBeNull();
    // A pointerdown that recorded no point must not count as ink either.
    expect(exportLayout([[], []])).toBeNull();
  });

  it("turns a single tap into a square exactly one training stroke wide", () => {
    const layout = exportLayout([[{ x: 50, y: 30 }]])!;

    expect(layout.width).toBe(TRAIN_STROKE_PX);
    expect(layout.height).toBe(TRAIN_STROKE_PX);
    expect(layout.strokeWidth).toBe(TRAIN_STROKE_PX);
  });

  it("makes a horizontal stroke exactly one training stroke tall", () => {
    const layout = exportLayout([line(10, 40, 110, 40)])!;

    expect(layout.height).toBe(TRAIN_STROKE_PX);
    expect(layout.width).toBe(Math.round((100 + PEN_PX) * (TRAIN_STROKE_PX / PEN_PX)));
    expect(layout.strokeWidth).toBe(TRAIN_STROKE_PX);
  });

  it("crops to the ink with no margin, like the training images", () => {
    const strokes = [line(20, 60, 80, 20), line(90, 70, 140, 65), [{ x: 30, y: 95 }]];
    const layout = exportLayout(strokes)!;
    const xs = strokes.flat().map((p) => (p.x - layout.offsetX) * layout.scale);
    const ys = strokes.flat().map((p) => (p.y - layout.offsetY) * layout.scale);
    const half = layout.strokeWidth / 2;

    // Outer stroke edges land on the image edges (±1 px of rounding).
    expect(Math.min(...xs) - half).toBeCloseTo(0, 6);
    expect(Math.min(...ys) - half).toBeCloseTo(0, 6);
    expect(Math.abs(Math.max(...xs) + half - layout.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(Math.max(...ys) + half - layout.height)).toBeLessThanOrEqual(1);
  });

  it("does not depend on where on the canvas the expression was drawn", () => {
    const here = exportLayout([line(10, 10, 60, 30)])!;
    const there = exportLayout([line(310, 210, 360, 230)])!;

    expect(there.width).toBe(here.width);
    expect(there.height).toBe(here.height);
    expect(there.strokeWidth).toBe(here.strokeWidth);
  });

  it("shrinks an over-wide drawing so its width is exactly the cap", () => {
    const layout = exportLayout([line(0, 0, 1000, 0)])!;

    expect(layout.width).toBe(MAX_EXPORT_PX);
    // Uniform shrink: the stroke gets thinner in proportion, and the image
    // stays exactly one (now thinner) stroke tall.
    expect(layout.strokeWidth).toBeLessThan(TRAIN_STROKE_PX);
    expect(layout.strokeWidth).toBeCloseTo(PEN_PX * layout.scale, 6);
    expect(layout.height).toBe(Math.round(layout.strokeWidth));
  });

  it("caps the height instead when the drawing is too tall", () => {
    const layout = exportLayout([line(0, 0, 0, 1000)])!;

    expect(layout.height).toBe(MAX_EXPORT_PX);
    expect(layout.width).toBeLessThan(MAX_EXPORT_PX);
  });

  it("handles a very long drawing without overflowing call arguments", () => {
    // ~30 minutes of pointer events at 120 Hz — well past the point where
    // Math.min(...points) throws a RangeError.
    const stroke: InkStroke = Array.from({ length: 250_000 }, (_, i) => ({
      x: i % 500,
      y: Math.floor(i / 500) % 80,
    }));

    expect(() => exportLayout([stroke])).not.toThrow();
    expect(exportLayout([stroke])!.width).toBe(MAX_EXPORT_PX);
  });

  it("scales from the given pen width, not a hard-coded one", () => {
    const layout = exportLayout([line(0, 0, 100, 0)], 8)!;

    expect(layout.scale).toBeCloseTo(TRAIN_STROKE_PX / 8, 6);
    expect(layout.strokeWidth).toBe(TRAIN_STROKE_PX);
  });
});
