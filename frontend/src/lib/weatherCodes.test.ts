import { describe, expect, it } from "vitest";
import { weatherCodeToDisplay } from "./weatherCodes";

describe("weatherCodeToDisplay", () => {
  it("maps clear sky", () => {
    expect(weatherCodeToDisplay(0)).toEqual({ icon: "☀️", label: "Nắng" });
  });

  it("maps mainly-clear and partly-cloudy to the same bucket", () => {
    expect(weatherCodeToDisplay(1)).toEqual({ icon: "🌤️", label: "Ít mây" });
    expect(weatherCodeToDisplay(2)).toEqual({ icon: "🌤️", label: "Ít mây" });
  });

  it("maps overcast", () => {
    expect(weatherCodeToDisplay(3)).toEqual({ icon: "☁️", label: "Nhiều mây" });
  });

  it("maps fog codes", () => {
    expect(weatherCodeToDisplay(45)).toEqual({ icon: "🌫️", label: "Sương mù" });
    expect(weatherCodeToDisplay(48)).toEqual({ icon: "🌫️", label: "Sương mù" });
  });

  it("maps rain/drizzle codes", () => {
    for (const code of [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82]) {
      expect(weatherCodeToDisplay(code)).toEqual({ icon: "🌧️", label: "Mưa" });
    }
  });

  it("maps snow codes", () => {
    for (const code of [71, 73, 75, 77, 85, 86]) {
      expect(weatherCodeToDisplay(code)).toEqual({ icon: "❄️", label: "Tuyết" });
    }
  });

  it("maps thunderstorm codes", () => {
    for (const code of [95, 96, 99]) {
      expect(weatherCodeToDisplay(code)).toEqual({ icon: "⛈️", label: "Dông" });
    }
  });

  it("falls back to a generic cloud for unrecognized codes", () => {
    expect(weatherCodeToDisplay(999)).toEqual({ icon: "☁️", label: "—" });
  });
});
