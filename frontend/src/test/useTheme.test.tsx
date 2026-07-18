import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useTheme } from "../hooks/useTheme";

describe("useTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("mặc định dark khi chưa có preference và OS không phải light", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("toggle đổi theme, ghi data-theme và localStorage", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggle());
    expect(result.current.theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("king-theme")).toBe("light");
  });

  it("đọc lại preference đã lưu", () => {
    localStorage.setItem("king-theme", "light");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
  });
});
