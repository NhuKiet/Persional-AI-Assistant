import { describe, expect, it } from "vitest";
import {
  GLASS_PRESETS,
  clampGlassValue,
  toGlassVisualValues,
} from "./newsGlassSettings";

describe("newsGlassSettings", () => {
  it("defines complete original and tuned presets", () => {
    expect(GLASS_PRESETS.original).toEqual({
      lightAngle: 111,
      lightIntensity: 50,
      refraction: 77,
      depth: 52,
      dispersion: 18,
      frost: 50,
      splay: 20,
    });
    expect(GLASS_PRESETS.tuned).toEqual({
      lightAngle: 111,
      lightIntensity: 50,
      refraction: 74,
      depth: 30,
      dispersion: 48,
      frost: 0,
      splay: 34,
    });
  });

  it("maps tuned settings to bounded CSS-ready values", () => {
    expect(toGlassVisualValues(GLASS_PRESETS.tuned)).toEqual({
      blur: "0.75px",
      tintAlpha: "0.120",
      lightAlpha: "0.500",
      depthY: "7.60px",
      depthBlur: "21.60px",
      depthAlpha: "0.158",
      dispersionLeft: "-4.36px",
      dispersionRight: "4.36px",
      splay: "14.12%",
    });
  });

  it("keeps the glint footprint small across the full Splay range", () => {
    expect(toGlassVisualValues({ ...GLASS_PRESETS.tuned, splay: 0 }).splay).toBe(
      "8.00%",
    );
    expect(toGlassVisualValues({ ...GLASS_PRESETS.tuned, splay: 100 }).splay).toBe(
      "26.00%",
    );
  });

  it("clamps editable values to each control range", () => {
    expect(clampGlassValue("lightAngle", 999)).toBe(360);
    expect(clampGlassValue("frost", -12)).toBe(0);
    expect(clampGlassValue("depth", Number.NaN)).toBe(0);
  });
});
