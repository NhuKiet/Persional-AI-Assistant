import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useTheme } from "../hooks/useTheme";

describe("useTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("mặc định light khi chưa có preference", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("toggle đổi theme, ghi data-theme và localStorage", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggle());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("king-theme")).toBe("dark");
  });

  it.each(["light", "dark"] as const)("đọc lại preference %s đã lưu", savedTheme => {
    localStorage.setItem("king-theme", savedTheme);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe(savedTheme);
    expect(document.documentElement.dataset.theme).toBe(savedTheme);
  });
});
