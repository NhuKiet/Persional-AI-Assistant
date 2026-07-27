import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TimeWeatherWidget from "./TimeWeatherWidget";

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

describe("TimeWeatherWidget", () => {
  it("always renders the clock, and shows weather once the fetch resolves", async () => {
    mockGeolocation("success");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ current_weather: { temperature: 28, weathercode: 0 } }),
    }));

    render(<TimeWeatherWidget />);

    expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/28°C/)).toBeInTheDocument());
    expect(screen.getByText(/Nắng/)).toBeInTheDocument();
  });

  it("omits the weather row (keeping the clock) when the fetch fails", async () => {
    mockGeolocation("success");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    render(<TimeWeatherWidget />);

    expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("…")).not.toBeInTheDocument());
    expect(screen.queryByText(/°C/)).not.toBeInTheDocument();
  });
});
