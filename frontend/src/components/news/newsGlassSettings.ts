export type GlassMode = "original" | "tuned";

export type GlassSettings = {
  lightAngle: number;
  lightIntensity: number;
  refraction: number;
  depth: number;
  dispersion: number;
  frost: number;
  splay: number;
};

export type GlassSettingName = keyof GlassSettings;

export type GlassVisualValues = {
  blur: string;
  tintAlpha: string;
  lightAlpha: string;
  depthY: string;
  depthBlur: string;
  depthAlpha: string;
  dispersionLeft: string;
  dispersionRight: string;
  splay: string;
};

export const GLASS_PRESETS: Record<GlassMode, GlassSettings> = {
  original: {
    lightAngle: 111,
    lightIntensity: 50,
    refraction: 77,
    depth: 52,
    dispersion: 18,
    frost: 50,
    splay: 20,
  },
  tuned: {
    lightAngle: 111,
    lightIntensity: 50,
    refraction: 74,
    depth: 30,
    dispersion: 48,
    frost: 0,
    splay: 34,
  },
};

const LIMITS: Record<GlassSettingName, [number, number]> = {
  lightAngle: [0, 360],
  lightIntensity: [0, 100],
  refraction: [0, 100],
  depth: [0, 100],
  dispersion: [0, 100],
  frost: [0, 100],
  splay: [0, 100],
};

export function clampGlassValue(name: GlassSettingName, value: number): number {
  const [min, max] = LIMITS[name];
  const safeValue = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, safeValue));
}

export function toGlassVisualValues(settings: GlassSettings): GlassVisualValues {
  const dispersion = 1 + settings.dispersion * 0.07;
  return {
    blur: `${(0.75 + settings.frost * 0.045).toFixed(2)}px`,
    tintAlpha: (0.12 + settings.frost * 0.004).toFixed(3),
    lightAlpha: (0.15 + settings.lightIntensity * 0.007).toFixed(3),
    depthY: `${(4 + settings.depth * 0.12).toFixed(2)}px`,
    depthBlur: `${(12 + settings.depth * 0.32).toFixed(2)}px`,
    depthAlpha: (0.08 + settings.depth * 0.0026).toFixed(3),
    dispersionLeft: `${(-dispersion).toFixed(2)}px`,
    dispersionRight: `${dispersion.toFixed(2)}px`,
    splay: `${(8 + settings.splay * 0.18).toFixed(2)}%`,
  };
}
