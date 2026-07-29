import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FallingLeaves } from "./FallingLeaves";

function makeContext(): CanvasRenderingContext2D {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(),
    globalAlpha: 1,
    filter: "none",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;
}

describe("FallingLeaves", () => {
  let context: CanvasRenderingContext2D;
  let mediaMatches: boolean;
  let mediaListener: (() => void) | undefined;
  let resizeCallback: (() => void) | undefined;
  const disconnect = vi.fn();

  beforeEach(() => {
    context = makeContext();
    mediaMatches = false;
    mediaListener = undefined;
    resizeCallback = undefined;
    disconnect.mockClear();

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => context,
    );
    vi.spyOn(
      HTMLCanvasElement.prototype,
      "getBoundingClientRect",
    ).mockReturnValue({
      width: 1200,
      height: 600,
      top: 0,
      left: 0,
      right: 1200,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name: string) =>
        ({
          "--news-leaf-copper": "#b77a59",
          "--news-leaf-gold": "#c0a36b",
          "--news-leaf-sage": "#7f8d73",
          "--news-leaf-rose": "#aa7772",
        })[name] ?? "",
    } as CSSStyleDeclaration);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        get matches() {
          return mediaMatches;
        },
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addEventListener: (_type: string, listener: () => void) => {
          mediaListener = listener;
        },
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: () => false,
      })),
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resizeCallback = callback;
        }
        observe() {}
        disconnect() {
          disconnect();
        }
      },
    );
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 41));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 3,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  it("caps DPR, builds twelve cached sprites, and cleans every lifecycle", () => {
    const { container, unmount } = render(<FallingLeaves />);
    const canvas = container.querySelector("canvas");

    expect(canvas).toHaveAttribute("aria-hidden", "true");
    expect(canvas?.width).toBe(2400);
    expect(canvas?.height).toBe(1200);
    expect(context.createLinearGradient).toHaveBeenCalledTimes(12);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

    act(() => resizeCallback?.());
    expect(context.createLinearGradient).toHaveBeenCalledTimes(12);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

    unmount();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(41);
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("pauses while hidden and resumes with one fresh frame", () => {
    render(<FallingLeaves />);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(cancelAnimationFrame).toHaveBeenCalledWith(41);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
  });

  it("draws five static leaves and schedules no loop under reduced motion", () => {
    mediaMatches = true;
    render(<FallingLeaves />);

    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(context.drawImage).toHaveBeenCalledTimes(5);
  });

  it("switches cleanly when the motion preference changes", () => {
    render(<FallingLeaves />);
    mediaMatches = true;

    act(() => mediaListener?.());

    expect(cancelAnimationFrame).toHaveBeenCalledWith(41);
    expect(context.drawImage).toHaveBeenCalled();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the canvas context is unavailable", () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);

    expect(() => render(<FallingLeaves />)).not.toThrow();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});
