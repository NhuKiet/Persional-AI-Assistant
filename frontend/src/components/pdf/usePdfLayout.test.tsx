import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePdfLayout, usePdfLayoutMode } from "./usePdfLayout";

beforeEach(() => {
  localStorage.clear();
});

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
    const setItem = vi.spyOn(localStorage, "setItem");
    const { result } = renderHook(() => usePdfLayout("desktop"), {
      wrapper: StrictMode,
    });

    act(() => result.current.toggleOutline());

    expect(setItem).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledWith("pdf-outline-open", "false");
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
