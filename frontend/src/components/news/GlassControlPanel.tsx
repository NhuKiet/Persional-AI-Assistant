import type { CSSProperties } from "react";
import type {
  GlassMode,
  GlassSettingName,
  GlassSettings,
} from "./newsGlassSettings";
import { clampGlassValue } from "./newsGlassSettings";

type GlassControlPanelProps = {
  activePreset: GlassMode;
  settings: GlassSettings;
  onPresetChange: (mode: GlassMode) => void;
  onSettingChange: (name: GlassSettingName, value: number) => void;
};

const RANGE_CONTROLS: Array<{
  name: Exclude<GlassSettingName, "lightAngle" | "lightIntensity">;
  label: string;
}> = [
  { name: "refraction", label: "Refraction" },
  { name: "depth", label: "Depth" },
  { name: "dispersion", label: "Dispersion" },
  { name: "frost", label: "Frost" },
  { name: "splay", label: "Splay" },
];

export function GlassControlPanel({
  activePreset,
  settings,
  onPresetChange,
  onSettingChange,
}: GlassControlPanelProps) {
  const update = (name: GlassSettingName, rawValue: string) => {
    onSettingChange(name, clampGlassValue(name, Number(rawValue)));
  };

  return (
    <div className="news-mode-content">
      <span className="news-mode-label">Tinh chỉnh vật liệu</span>
      <div className="news-mode-buttons">
        {(["original", "tuned"] as GlassMode[]).map((mode) => (
          <button
            key={mode}
            className="news-mode-button"
            type="button"
            onClick={() => onPresetChange(mode)}
            aria-pressed={activePreset === mode}
          >
            {mode === "original" ? "Nguyên bản" : "Tinh chỉnh"}
          </button>
        ))}
      </div>

      <div className="news-light-control">
        <span className="news-control-label">Light</span>
        <div
          className="news-light-pad"
          style={{ "--news-dial-angle": `${settings.lightAngle}deg` } as CSSProperties}
          aria-hidden="true"
        />
        <div className="news-light-values">
          <label>
            <span className="news-sr-only">Góc sáng</span>
            <input
              type="number"
              min="0"
              max="360"
              value={settings.lightAngle}
              onChange={(event) => update("lightAngle", event.target.value)}
              aria-label="Góc sáng"
            />
            <span>°</span>
          </label>
          <label>
            <span className="news-sr-only">Cường độ sáng</span>
            <input
              type="number"
              min="0"
              max="100"
              value={settings.lightIntensity}
              onChange={(event) => update("lightIntensity", event.target.value)}
              aria-label="Cường độ sáng"
            />
            <span>%</span>
          </label>
        </div>
      </div>

      <div className="news-glass-ranges">
        {RANGE_CONTROLS.map(({ name, label }) => (
          <label className="news-range-row" key={name}>
            <span className="news-control-label">{label}</span>
            <input
              type="range"
              min="0"
              max="100"
              value={settings[name]}
              onChange={(event) => update(name, event.target.value)}
              aria-label={label}
              style={{ "--news-range-fill": `${settings[name]}%` } as CSSProperties}
            />
            <output>{settings[name]}</output>
          </label>
        ))}
      </div>
    </div>
  );
}
