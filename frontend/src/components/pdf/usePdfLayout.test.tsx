import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePdfLayout, usePdfLayoutMode, type PdfLayoutMode } from "./usePdfLayout";

beforeEach(() => {
  localStorage.clear();
});

/** Runs `run` with `localStorage` replaced on both globals the hook can reach. */
function withLocalStorage(storage: unknown, run: () => void): void {
  const original = window.localStorage;
  const install = (value: unknown) => {
    for (const target of [window, globalThis]) {
      Object.defineProperty(target, "localStorage", { configurable: true, value });
    }
  };
  install(storage);
  try {
    run();
  } finally {
    install(original);
  }
}

describe("usePdfLayout", () => {
  it("persists independently collapsible desktop panels", () => {
    const { result } = renderHook(() => usePdfLayout("desktop"));

    act(() => result.current.toggleOutline());

    expect(result.current.outlineOpen).toBe(false);
    expect(result.current.assistantOpen).toBe(true);
    expect(localStorage.getItem("pdf-outline-open")).toBe("false");
  });

  it("restores desktop preferences but starts laptop with only the assistant", () => {
    localStorage.setItem("pdf-outline-open", "true");
    localStorage.setItem("pdf-assistant-open", "false");

    const desktop = renderHook(() => usePdfLayout("desktop"));
    expect(desktop.result.current.outlineOpen).toBe(true);
    expect(desktop.result.current.assistantOpen).toBe(false);
    desktop.unmount();

    localStorage.setItem("pdf-assistant-open", "true");
    const laptop = renderHook(() => usePdfLayout("laptop"));
    expect(laptop.result.current.outlineOpen).toBe(false);
    expect(laptop.result.current.assistantOpen).toBe(true);
  });

  it("keeps narrow overlays mutually exclusive", () => {
    const { result } = renderHook(() => usePdfLayout("narrow"));

    act(() => result.current.toggleOutline());
    act(() => result.current.toggleAssistant());

    expect(result.current.outlineOpen).toBe(false);
    expect(result.current.assistantOpen).toBe(true);
  });

  it("applies narrow defaults synchronously and restores desktop preferences", () => {
    localStorage.setItem("pdf-outline-open", "true");
    localStorage.setItem("pdf-assistant-open", "true");
    const { result, rerender } = renderHook(
      ({ mode }) => usePdfLayout(mode),
      { initialProps: { mode: "desktop" as PdfLayoutMode } },
    );

    rerender({ mode: "narrow" });
    expect(result.current.outlineOpen).toBe(false);
    expect(result.current.assistantOpen).toBe(false);
    act(() => result.current.toggleAssistant());
    expect(result.current.assistantOpen).toBe(true);

    rerender({ mode: "desktop" });
    expect(result.current.outlineOpen).toBe(true);
    expect(result.current.assistantOpen).toBe(true);
  });

  it("uses a transient laptop outline drawer and a persisted docked assistant", () => {
    const { result, rerender } = renderHook(
      ({ mode }) => usePdfLayout(mode),
      { initialProps: { mode: "desktop" as PdfLayoutMode } },
    );

    rerender({ mode: "laptop" });
    expect(result.current.outlineOpen).toBe(false);
    expect(result.current.assistantOpen).toBe(true);
    act(() => result.current.toggleOutline());
    act(() => result.current.toggleAssistant());
    expect(result.current.outlineOpen).toBe(true);
    expect(result.current.assistantOpen).toBe(false);
    expect(localStorage.getItem("pdf-outline-open")).toBe(null);
    expect(localStorage.getItem("pdf-assistant-open")).toBe("false");

    rerender({ mode: "desktop" });
    expect(result.current.outlineOpen).toBe(true);
    expect(result.current.assistantOpen).toBe(false);
  });

  it("closes narrow overlays without overwriting stored desktop preferences", () => {
    localStorage.setItem("pdf-outline-open", "true");
    localStorage.setItem("pdf-assistant-open", "true");
    const { result } = renderHook(() => usePdfLayout("narrow"));

    act(() => result.current.toggleOutline());
    act(() => result.current.closeOverlays());

    expect(result.current.outlineOpen).toBe(false);
    expect(result.current.assistantOpen).toBe(false);
    expect(localStorage.getItem("pdf-outline-open")).toBe("true");
    expect(localStorage.getItem("pdf-assistant-open")).toBe("true");
  });

  it("writes a toggled preference once under StrictMode", () => {
    // A recording stand-in, not vi.spyOn(localStorage, "setItem"): jsdom keeps
    // Storage's methods on its prototype, so a spy placed on the instance
    // never sees a call. That spy passed on Node 26, where setup.js swaps in a
    // plain-object shim, and failed on CI's Node 20, which has jsdom's Storage.
    const writes: [string, string][] = [];
    const recording = {
      getItem: () => null,
      setItem: (key: string, value: string) => void writes.push([key, value]),
    };

    withLocalStorage(recording, () => {
      const { result } = renderHook(() => usePdfLayout("desktop"), {
        wrapper: StrictMode,
      });

      act(() => result.current.toggleOutline());
    });

    expect(writes).toEqual([["pdf-outline-open", "false"]]);
  });

  it("uses defaults when storage is unavailable", () => {
    withLocalStorage(undefined, () => {
      const { result } = renderHook(() => usePdfLayout("desktop"));

      expect(result.current.outlineOpen).toBe(true);
      expect(result.current.assistantOpen).toBe(true);
    });
  });
});

describe("usePdfLayoutMode", () => {
  it.each([
    [899, "narrow"],
    [900, "laptop"],
    [1279, "laptop"],
    [1280, "desktop"],
  ] as const)("maps a %dpx viewport to %s", (width, expected) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });

    const { result } = renderHook(() => usePdfLayoutMode());

    expect(result.current).toBe(expected);
  });

  it("updates on resize and removes its listener on unmount", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1400 });
    const removeEventListener = vi.spyOn(window, "removeEventListener");
    const { result, unmount } = renderHook(() => usePdfLayoutMode());

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(result.current).toBe("narrow");

    unmount();
    expect(removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
  });
});
