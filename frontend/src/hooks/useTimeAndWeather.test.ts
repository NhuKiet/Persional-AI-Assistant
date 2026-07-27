import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTimeAndWeather } from "./useTimeAndWeather";

function mockGeolocation(behavior: "success" | "error") {
  const getCurrentPosition = vi.fn(
    (success: PositionCallback, error?: PositionErrorCallback) => {
      if (behavior === "success") {
        success({ coords: { latitude: 10, longitude: 20 } } as GeolocationPosition);
      } else {
        error?.(new Error("denied") as unknown as GeolocationPositionError);
      }
    },
  );
  Object.defineProperty(navigator, "geolocation", {
    value: { getCurrentPosition },
    configurable: true,
  });
}

describe("useTimeAndWeather", () => {
  it("fetches weather using the real geolocation coords on success", async () => {
    mockGeolocation("success");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ current_weather: { temperature: 28, weathercode: 1 } }),
    }));

    const { result } = renderHook(() => useTimeAndWeather());

    await waitFor(() => expect(result.current.weather.loading).toBe(false));
    expect(result.current.weather).toEqual({ tempC: 28, code: 1, loading: false, failed: false });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("latitude=10&longitude=20"));
  });

  it("falls back to Hanoi coords when geolocation errors", async () => {
    mockGeolocation("error");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ current_weather: { temperature: 30, weathercode: 3 } }),
    }));

    const { result } = renderHook(() => useTimeAndWeather());

    await waitFor(() => expect(result.current.weather.loading).toBe(false));
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("latitude=21.0285&longitude=105.8542"));
  });

  it("marks weather as failed when the fetch rejects, without touching the clock", async () => {
    mockGeolocation("success");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const { result } = renderHook(() => useTimeAndWeather());

    await waitFor(() => expect(result.current.weather.loading).toBe(false));
    expect(result.current.weather.failed).toBe(true);
    expect(result.current.now).toBeInstanceOf(Date);
  });

  it("marks weather as failed when Open-Meteo returns a non-ok response", async () => {
    mockGeolocation("success");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));

    const { result } = renderHook(() => useTimeAndWeather());

    await waitFor(() => expect(result.current.weather.loading).toBe(false));
    expect(result.current.weather.failed).toBe(true);
  });

  it("ticks the clock forward once a minute", async () => {
    vi.useFakeTimers();
    mockGeolocation("success");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));

    const { result } = renderHook(() => useTimeAndWeather());
    // getCurrentPosition's success callback fires synchronously on mount,
    // kicking off fetchWeather's promise chain. Fake timers only virtualize
    // setInterval/setTimeout, not native Promise microtasks — flush those
    // (still wrapped in act) before advancing the clock, so the eventual
    // setWeather call from that chain doesn't land outside any act() scope.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const first = result.current.now;

    act(() => { vi.advanceTimersByTime(60_000); });

    expect(result.current.now.getTime()).toBe(first.getTime() + 60_000);
    vi.useRealTimers();
  });
});
