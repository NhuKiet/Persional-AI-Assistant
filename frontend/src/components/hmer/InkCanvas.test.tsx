import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InkCanvas } from "./InkCanvas";
import type { InkStroke } from "../../lib/hmerInk";

/* jsdom has no canvas rasteriser (setup.js makes getContext return null).
   The preview only needs the calls to exist; what gets exported is tested
   through the injected exportImage, and the real rasterisation is measured
   in the browser (plan T4). */
function makeContext(): CanvasRenderingContext2D {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    strokeStyle: "",
    fillStyle: "",
  } as unknown as CanvasRenderingContext2D;
}

const PAD_RECT = { left: 10, top: 20, width: 400, height: 220, right: 410, bottom: 240, x: 10, y: 20 };

function setup(props: Partial<Parameters<typeof InkCanvas>[0]> = {}) {
  const onSubmit = vi.fn();
  const exportImage = vi.fn(async (_strokes: InkStroke[]) => new File(["png"], "ve-tay.png", { type: "image/png" }));
  render(<InkCanvas busy={false} onSubmit={onSubmit} exportImage={exportImage} {...props} />);
  const pad = screen.getByLabelText(/Khung vẽ công thức/i);
  vi.spyOn(pad, "getBoundingClientRect").mockReturnValue(PAD_RECT as DOMRect);
  return { pad, onSubmit, exportImage };
}

/** Pen down at the first point, through the rest, up at the last. */
function draw(pad: HTMLElement, points: [number, number][], init: Record<string, unknown> = {}) {
  const [first, ...rest] = points;
  const base = { pointerId: 1, pointerType: "mouse", button: 0, ...init };
  fireEvent.pointerDown(pad, { ...base, clientX: first[0], clientY: first[1] });
  for (const [x, y] of rest) fireEvent.pointerMove(pad, { ...base, clientX: x, clientY: y });
  const [lx, ly] = points[points.length - 1];
  fireEvent.pointerUp(pad, { ...base, clientX: lx, clientY: ly });
}

const submitButton = () => screen.getByRole("button", { name: "Nhận dạng" });

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => makeContext() as unknown as RenderingContext,
  );
});

describe("InkCanvas", () => {
  it("cannot be submitted until something is drawn", () => {
    const { pad } = setup();

    expect(submitButton()).toBeDisabled();
    expect(screen.getByText(/Viết công thức ở đây/i)).toBeInTheDocument();

    draw(pad, [[60, 70], [120, 70]]);

    expect(submitButton()).toBeEnabled();
    expect(screen.queryByText(/Viết công thức ở đây/i)).not.toBeInTheDocument();
  });

  it("sends strokes in canvas coordinates, then hands the image to onSubmit", async () => {
    const { pad, onSubmit, exportImage } = setup();

    draw(pad, [[60, 70], [90, 75], [120, 70]]);
    draw(pad, [[200, 100]]);
    fireEvent.click(submitButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    // clientX/Y minus the pad's top-left corner (10, 20).
    expect(exportImage).toHaveBeenCalledWith([
      [{ x: 50, y: 50 }, { x: 80, y: 55 }, { x: 110, y: 50 }],
      [{ x: 190, y: 80 }],
    ]);
    expect(onSubmit.mock.calls[0][0]).toBeInstanceOf(File);
  });

  it("undo removes only the last stroke", async () => {
    const { pad, exportImage } = setup();

    draw(pad, [[60, 70], [120, 70]]);
    draw(pad, [[60, 120], [120, 120]]);
    fireEvent.click(screen.getByRole("button", { name: "Hoàn tác" }));
    fireEvent.click(submitButton());

    await waitFor(() => expect(exportImage).toHaveBeenCalled());
    expect(exportImage.mock.calls[0][0]).toEqual([[{ x: 50, y: 50 }, { x: 110, y: 50 }]]);

    fireEvent.click(screen.getByRole("button", { name: "Hoàn tác" }));
    expect(submitButton()).toBeDisabled();
  });

  it("clear removes every stroke", () => {
    const { pad } = setup();

    draw(pad, [[60, 70], [120, 70]]);
    draw(pad, [[60, 120], [120, 120]]);
    fireEvent.click(screen.getByRole("button", { name: "Xoá" }));

    expect(submitButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Hoàn tác" })).toBeDisabled();
  });

  it("stays disabled while a recognition is running", () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<InkCanvas busy={false} onSubmit={onSubmit} exportImage={vi.fn()} />);
    const pad = screen.getByLabelText(/Khung vẽ công thức/i);
    vi.spyOn(pad, "getBoundingClientRect").mockReturnValue(PAD_RECT as DOMRect);
    draw(pad, [[60, 70], [120, 70]]);

    rerender(<InkCanvas busy onSubmit={onSubmit} exportImage={vi.fn()} />);

    expect(submitButton()).toBeDisabled();
  });

  it("ignores a second finger while a stroke is in progress", async () => {
    const { pad, exportImage } = setup();
    const touch = { pointerType: "touch" };

    fireEvent.pointerDown(pad, { ...touch, pointerId: 1, clientX: 60, clientY: 70 });
    fireEvent.pointerDown(pad, { ...touch, pointerId: 2, clientX: 300, clientY: 200 });
    fireEvent.pointerMove(pad, { ...touch, pointerId: 2, clientX: 310, clientY: 210 });
    fireEvent.pointerMove(pad, { ...touch, pointerId: 1, clientX: 120, clientY: 70 });
    fireEvent.pointerUp(pad, { ...touch, pointerId: 2, clientX: 310, clientY: 210 });
    fireEvent.pointerUp(pad, { ...touch, pointerId: 1, clientX: 120, clientY: 70 });
    fireEvent.click(submitButton());

    await waitFor(() => expect(exportImage).toHaveBeenCalled());
    expect(exportImage.mock.calls[0][0]).toEqual([[{ x: 50, y: 50 }, { x: 110, y: 50 }]]);
  });

  it("ignores right and middle mouse buttons", () => {
    const { pad } = setup();

    draw(pad, [[60, 70], [120, 70]], { button: 2 });

    expect(submitButton()).toBeDisabled();
  });

  it("says so when the drawing cannot be exported, without submitting", async () => {
    const onSubmit = vi.fn();
    const exportImage = vi.fn(async () => {
      throw new Error("canvas bị chặn");
    });
    const { pad } = setup({ onSubmit, exportImage });

    draw(pad, [[60, 70], [120, 70]]);
    fireEvent.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(/canvas bị chặn/);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
