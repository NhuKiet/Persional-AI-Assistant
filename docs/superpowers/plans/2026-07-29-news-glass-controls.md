# News Glass Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live seven-parameter glass control panel to `/news`, remove the background grid, and replace the continuous white glass rim with localized highlights.

**Architecture:** Keep `NewsPage` responsible for the selected preset and current settings. Put preset values and value-to-CSS mapping in a small pure module, and put the control markup in a focused `GlassControlPanel` component. Pass the resulting CSS custom properties to the existing News page root so all current glass layers update together.

**Tech Stack:** React 18, TypeScript, plain CSS, SVG filters, Vitest, Testing Library.

## Global Constraints

- Keep the real news loading, refresh action, topic filters, auroras, caustics, and four decorative glass layers.
- Keep `Nguyên bản` and `Tinh chỉnh` as complete presets.
- Use React state and CSS custom properties; do not add Canvas, WebGL, a UI library, a dependency, or a new stylesheet.
- Keep SVG filters off text and icons.
- Remove `.news-liquid-ambient::before` completely.
- No glass surface may have an uninterrupted white perimeter or active white outline.
- Preserve keyboard operation, visible focus, responsive layout, and `prefers-reduced-motion`.

---

## File Map

- Create `frontend/src/components/news/newsGlassSettings.ts`: settings type, presets, clamping, and visual-value mapping.
- Create `frontend/src/components/news/newsGlassSettings.test.ts`: pure mapping and preset tests.
- Create `frontend/src/components/news/GlassControlPanel.tsx`: preset buttons and seven accessible controls.
- Create `frontend/src/components/news/GlassControlPanel.test.tsx`: control rendering and callback tests.
- Modify `frontend/src/pages/NewsPage.tsx`: own settings state, apply CSS variables, update SVG displacement, and mount the panel.
- Modify `frontend/src/pages/NewsPage.test.tsx`: integration tests for preset and live slider updates.
- Modify `frontend/src/styles/news.css`: dark instrument styling, slider styling, live glass variables, grid removal, and rim cleanup.
- Modify `frontend/src/test/news-liquid-bars.contract.test.ts`: CSS/markup contracts for the panel, removed grid, and removed white perimeter.

---

### Task 1: Define Glass Settings and Visual Mapping

**Files:**
- Create: `frontend/src/components/news/newsGlassSettings.ts`
- Create: `frontend/src/components/news/newsGlassSettings.test.ts`

**Interfaces:**
- Produces: `GlassMode`, `GlassSettings`, `GlassVisualValues`, `GLASS_PRESETS`, `clampGlassValue()`, and `toGlassVisualValues()`.
- Consumed by: `GlassControlPanel.tsx` and `NewsPage.tsx`.

- [ ] **Step 1: Write the failing pure-module tests**

```ts
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
      splay: "42.48%",
    });
  });

  it("clamps editable values to each control range", () => {
    expect(clampGlassValue("lightAngle", 999)).toBe(360);
    expect(clampGlassValue("frost", -12)).toBe(0);
    expect(clampGlassValue("depth", Number.NaN)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
cd frontend
npm.cmd test -- --run src/components/news/newsGlassSettings.test.ts
```

Expected: FAIL because `newsGlassSettings.ts` does not exist.

- [ ] **Step 3: Implement the pure settings module**

```ts
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
    splay: `${(18 + settings.splay * 0.72).toFixed(2)}%`,
  };
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```powershell
npm.cmd test -- --run src/components/news/newsGlassSettings.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit the settings unit**

```powershell
git add frontend/src/components/news/newsGlassSettings.ts frontend/src/components/news/newsGlassSettings.test.ts
git commit -m "feat(news): define live glass settings"
```

---

### Task 2: Build the Accessible Control Panel

**Files:**
- Create: `frontend/src/components/news/GlassControlPanel.tsx`
- Create: `frontend/src/components/news/GlassControlPanel.test.tsx`

**Interfaces:**
- Consumes: `GlassMode`, `GlassSettings`, `GlassSettingName`, and `clampGlassValue()` from `newsGlassSettings.ts`.
- Produces:

```ts
type GlassControlPanelProps = {
  activePreset: GlassMode;
  settings: GlassSettings;
  onPresetChange: (mode: GlassMode) => void;
  onSettingChange: (name: GlassSettingName, value: number) => void;
};
```

- [ ] **Step 1: Write failing panel tests**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GLASS_PRESETS } from "./newsGlassSettings";
import { GlassControlPanel } from "./GlassControlPanel";

describe("GlassControlPanel", () => {
  it("renders two Light editors and five named range controls", () => {
    render(
      <GlassControlPanel
        activePreset="tuned"
        settings={GLASS_PRESETS.tuned}
        onPresetChange={vi.fn()}
        onSettingChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("spinbutton", { name: "Góc sáng" })).toHaveValue(111);
    expect(screen.getByRole("spinbutton", { name: "Cường độ sáng" })).toHaveValue(50);
    for (const name of ["Refraction", "Depth", "Dispersion", "Frost", "Splay"]) {
      expect(screen.getByRole("slider", { name })).toBeInTheDocument();
    }
  });

  it("reports preset and clamped setting changes", async () => {
    const user = userEvent.setup();
    const onPresetChange = vi.fn();
    const onSettingChange = vi.fn();
    render(
      <GlassControlPanel
        activePreset="tuned"
        settings={GLASS_PRESETS.tuned}
        onPresetChange={onPresetChange}
        onSettingChange={onSettingChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Nguyên bản" }));
    expect(onPresetChange).toHaveBeenCalledWith("original");

    fireEvent.change(screen.getByRole("slider", { name: "Dispersion" }), {
      target: { value: "86" },
    });
    expect(onSettingChange).toHaveBeenCalledWith("dispersion", 86);
  });
});
```

- [ ] **Step 2: Run the panel test and verify RED**

Run:

```powershell
npm.cmd test -- --run src/components/news/GlassControlPanel.test.tsx
```

Expected: FAIL because `GlassControlPanel.tsx` does not exist.

- [ ] **Step 3: Implement the panel**

```tsx
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
```

- [ ] **Step 4: Run the panel tests and verify GREEN**

Run:

```powershell
npm.cmd test -- --run src/components/news/GlassControlPanel.test.tsx
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit the panel component**

```powershell
git add frontend/src/components/news/GlassControlPanel.tsx frontend/src/components/news/GlassControlPanel.test.tsx
git commit -m "feat(news): add glass control panel"
```

---

### Task 3: Integrate Live Settings with the News Glass

**Files:**
- Modify: `frontend/src/pages/NewsPage.tsx`
- Modify: `frontend/src/pages/NewsPage.test.tsx`

**Interfaces:**
- Consumes: `GlassControlPanel`, `GLASS_PRESETS`, `GlassMode`, `GlassSettingName`, `GlassSettings`, and `toGlassVisualValues()`.
- Produces: CSS variables on `.news-page` and a live `scale` attribute on `#news-glass-displacement`.

- [ ] **Step 1: Replace the old preset test with failing integration tests**

Add `fireEvent` to the Testing Library import and replace the current
`switches the whole layered material...` test with:

```tsx
it("loads every value when the user selects a glass preset", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    jsonResponse({ items: [], limit: 20, offset: 0, has_more: false }),
  ));
  const user = userEvent.setup();
  const { container } = renderPage();

  expect(screen.getByRole("slider", { name: "Refraction" })).toHaveValue("74");
  expect(container.querySelector("#news-glass-displacement")).toHaveAttribute("scale", "74");

  await user.click(screen.getByRole("button", { name: "Nguyên bản" }));

  expect(screen.getByRole("spinbutton", { name: "Góc sáng" })).toHaveValue(111);
  expect(screen.getByRole("slider", { name: "Refraction" })).toHaveValue("77");
  expect(screen.getByRole("slider", { name: "Frost" })).toHaveValue("50");
  expect(container.querySelector("#news-glass-displacement")).toHaveAttribute("scale", "77");
});

it("updates the shared glass material while a control moves", () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    jsonResponse({ items: [], limit: 20, offset: 0, has_more: false }),
  ));
  const { container } = renderPage();
  const main = screen.getByRole("main");

  fireEvent.change(screen.getByRole("slider", { name: "Dispersion" }), {
    target: { value: "80" },
  });
  fireEvent.change(screen.getByRole("slider", { name: "Frost" }), {
    target: { value: "60" },
  });

  expect(screen.getByRole("slider", { name: "Dispersion" })).toHaveValue("80");
  expect(main).toHaveStyle({
    "--news-dispersion-left": "-6.60px",
    "--news-dispersion-right": "6.60px",
    "--news-blur": "3.45px",
  });
  expect(container.querySelectorAll(".news-glass-effect").length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run the News page tests and verify RED**

Run:

```powershell
npm.cmd test -- --run src/pages/NewsPage.test.tsx
```

Expected: FAIL because the static readout has no named sliders and displacement
still reads the old `mode.scale`.

- [ ] **Step 3: Integrate state, SVG, variables, and the panel**

In `NewsPage.tsx`:

```tsx
import { useState, type CSSProperties } from "react";
import { GlassControlPanel } from "../components/news/GlassControlPanel";
import {
  GLASS_PRESETS,
  toGlassVisualValues,
  type GlassMode,
  type GlassSettingName,
  type GlassSettings,
} from "../components/news/newsGlassSettings";
```

Remove the local `GlassMode` and `GLASS_MODES`. Inside `NewsPage`, use:

```tsx
const [glassMode, setGlassMode] = useState<GlassMode>("tuned");
const [glassSettings, setGlassSettings] = useState<GlassSettings>(() => ({
  ...GLASS_PRESETS.tuned,
}));
const visualValues = toGlassVisualValues(glassSettings);
const glassStyle = {
  "--news-light-angle": `${glassSettings.lightAngle}deg`,
  "--news-light-alpha": visualValues.lightAlpha,
  "--news-blur": visualValues.blur,
  "--news-tint-alpha": visualValues.tintAlpha,
  "--news-depth-y": visualValues.depthY,
  "--news-depth-blur": visualValues.depthBlur,
  "--news-depth-alpha": visualValues.depthAlpha,
  "--news-dispersion-left": visualValues.dispersionLeft,
  "--news-dispersion-right": visualValues.dispersionRight,
  "--news-splay": visualValues.splay,
} as CSSProperties;

const selectGlassPreset = (mode: GlassMode) => {
  setGlassMode(mode);
  setGlassSettings({ ...GLASS_PRESETS[mode] });
};

const updateGlassSetting = (name: GlassSettingName, value: number) => {
  setGlassSettings((current) => ({ ...current, [name]: value }));
};
```

Add `style={glassStyle}` to `<main>`, change SVG displacement to:

```tsx
scale={glassSettings.refraction}
```

Replace `.news-mode-content` and its old definition list with:

```tsx
<GlassControlPanel
  activePreset={glassMode}
  settings={glassSettings}
  onPresetChange={selectGlassPreset}
  onSettingChange={updateGlassSetting}
/>
```

- [ ] **Step 4: Run News and panel tests and verify GREEN**

Run:

```powershell
npm.cmd test -- --run src/pages/NewsPage.test.tsx src/components/news/GlassControlPanel.test.tsx src/components/news/newsGlassSettings.test.ts
```

Expected: all targeted tests PASS.

- [ ] **Step 5: Commit the integration**

```powershell
git add frontend/src/pages/NewsPage.tsx frontend/src/pages/NewsPage.test.tsx
git commit -m "feat(news): wire controls to layered glass"
```

---

### Task 4: Style the Instrument Panel and Refine the Glass Edge

**Files:**
- Modify: `frontend/src/styles/news.css`
- Modify: `frontend/src/test/news-liquid-bars.contract.test.ts`

**Interfaces:**
- Consumes CSS properties set by `NewsPage`: `--news-light-angle`, `--news-light-alpha`, `--news-blur`, `--news-tint-alpha`, `--news-depth-y`, `--news-depth-blur`, `--news-depth-alpha`, `--news-dispersion-left`, `--news-dispersion-right`, and `--news-splay`.
- Produces the final desktop/mobile appearance.

- [ ] **Step 1: Write failing CSS contracts**

Add these tests to `news-liquid-bars.contract.test.ts`:

```ts
it("removes the grid and continuous white glass outline", () => {
  expect(newsCss).not.toContain(".news-liquid-ambient::before");
  const shine = newsCss.match(/\.news-glass-shine\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  const active = newsCss.match(/\.news-tab-active\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  expect(shine).not.toMatch(/\bborder\s*:/);
  expect(shine).not.toMatch(/inset -1px -1px 1px 1px var\(--news-rim-light\)/);
  expect(active).not.toMatch(/0 0 0 2px rgba\(255, 255, 255/);
});

it("styles a responsive seven-value glass instrument panel", () => {
  for (const selector of [
    ".news-light-control",
    ".news-light-pad",
    ".news-light-values",
    ".news-glass-ranges",
    ".news-range-row",
  ]) {
    expect(newsCss).toContain(selector);
  }
  expect(glassPanel).toMatch(/type="number"[\s\S]*aria-label="Góc sáng"/);
  expect(glassPanel).toMatch(/type="number"[\s\S]*aria-label="Cường độ sáng"/);
  expect(glassPanel.match(/type="range"/g)).toHaveLength(1);
  expect(glassPanel).toContain("RANGE_CONTROLS.map");
  expect(newsCss).toMatch(/@media \(max-width: 700px\)[\s\S]*\.news-mode-panel/);
});

it("maps live variables onto only decorative glass layers", () => {
  expect(newsCss).toMatch(/\.news-glass-effect\s*\{[\s\S]*blur\(var\(--news-blur\)\)/);
  expect(newsCss).toMatch(/\.news-glass-tint\s*\{[\s\S]*var\(--news-tint-alpha\)/);
  expect(newsCss).toMatch(/\.news-glass-shine::after\s*\{[\s\S]*var\(--news-light-angle\)[\s\S]*var\(--news-light-alpha\)[\s\S]*var\(--news-splay\)/);
  expect(newsCss).toMatch(/\.news-glass-shine::before\s*\{[\s\S]*var\(--news-dispersion-left\)[\s\S]*var\(--news-dispersion-right\)/);
});
```

Update the contract fixture to also read:

```ts
const glassPanel = readFileSync(
  path.join(srcDirectory, "components/news/GlassControlPanel.tsx"),
  "utf8",
);
```

Use `glassPanel`, not `newsPage`, for the number/range markup assertions.

- [ ] **Step 2: Run the CSS contract and verify RED**

Run:

```powershell
npm.cmd test -- --run src/test/news-liquid-bars.contract.test.ts
```

Expected: FAIL because the grid, white rim, and static panel styling still exist.

- [ ] **Step 3: Remove the grid and establish live material variables**

Delete `.news-liquid-ambient::before`. Replace the static tint/rim tokens at
the top of `.news-page` with:

```css
  --news-blur: 0.75px;
  --news-tint-alpha: 0.12;
  --news-light-angle: 111deg;
  --news-light-alpha: 0.5;
  --news-depth-y: 7.6px;
  --news-depth-blur: 21.6px;
  --news-depth-alpha: 0.158;
  --news-dispersion-left: -4.36px;
  --news-dispersion-right: 4.36px;
  --news-splay: 42.48%;
  --news-panel-bg: rgb(31 33 38 / 92%);
  --news-panel-raised: rgb(255 255 255 / 7%);
  --news-panel-track: rgb(255 255 255 / 9%);
  --news-panel-text: #f4f7fb;
  --news-panel-muted: #aeb5c2;
  --news-panel-accent: #209ce8;
  --news-panel-thumb: #f7fbff;
```

Delete `.news-layered-tuned` material variable overrides. Change tint and the
shared object shadow:

```css
.news-command-bar,
.news-back,
.news-refresh-btn,
.news-tab,
.news-lens,
.news-mode-panel {
  box-shadow:
    0 var(--news-depth-y) var(--news-depth-blur)
      rgb(17 35 64 / var(--news-depth-alpha));
}

.news-glass-tint {
  z-index: 1;
  background: rgb(255 255 255 / var(--news-tint-alpha));
}
```

- [ ] **Step 4: Replace the white rim with localized light and dispersion**

```css
.news-glass-shine {
  z-index: 2;
  overflow: hidden;
  box-shadow:
    inset 0 -7px 16px rgb(54 79 118 / var(--news-depth-alpha));
}

.news-glass-shine::before {
  position: absolute;
  top: 2px;
  left: 50%;
  width: min(68%, var(--news-splay));
  height: 2px;
  border-radius: 999px;
  box-shadow:
    var(--news-dispersion-left) 0 5px rgb(74 227 255 / 62%),
    var(--news-dispersion-right) 0 5px rgb(255 125 216 / 42%);
  content: "";
  transform: translateX(-50%);
}

.news-glass-shine::after {
  position: absolute;
  top: 3px;
  left: 50%;
  width: var(--news-splay);
  height: 24%;
  border-radius: 999px;
  background:
    linear-gradient(
      var(--news-light-angle),
      rgb(255 255 255 / var(--news-light-alpha)),
      rgb(255 255 255 / 10%) 46%,
      transparent 88%
    );
  content: "";
  filter: url(#news-liquid-refraction);
  transform: translateX(-50%);
}
```

Change `.news-tab-active` to remove the white ring:

```css
.news-tab-active {
  color: #fff;
  text-shadow: 0 1px 2px rgba(9, 44, 96, 0.34);
  box-shadow:
    0 var(--news-depth-y) var(--news-depth-blur) rgba(11, 118, 204, 0.3);
}
```

Remove the white inset line from `.news-tab-active .news-glass-shine`; retain
only:

```css
.news-tab-active .news-glass-shine {
  box-shadow: inset 0 -12px 22px rgba(16, 63, 183, 0.24);
}
```

- [ ] **Step 5: Style the dark control panel and native controls**

Replace the old `.news-mode-readout` rules with:

```css
.news-mode-panel {
  width: 320px;
  padding: 14px;
  border-radius: 22px;
  color: var(--news-panel-text);
}

.news-mode-panel .news-glass-tint {
  background: var(--news-panel-bg);
}

.news-mode-content {
  position: relative;
  z-index: 3;
  display: grid;
  gap: 12px;
}

.news-mode-label,
.news-control-label {
  color: var(--news-panel-muted);
  font-size: 12px;
  font-weight: 700;
}

.news-mode-buttons {
  background: var(--news-panel-raised);
}

.news-mode-button {
  color: var(--news-panel-muted);
}

.news-mode-button[aria-pressed="true"] {
  color: var(--news-panel-text);
  background: rgb(255 255 255 / 10%);
  box-shadow: none;
}

.news-light-control {
  display: grid;
  grid-template-columns: 80px 70px 1fr;
  align-items: center;
  gap: 10px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgb(255 255 255 / 9%);
}

.news-light-pad {
  position: relative;
  width: 70px;
  height: 64px;
  border-radius: 11px;
  background:
    linear-gradient(var(--news-dial-angle), rgb(255 255 255 / 28%), transparent 62%),
    var(--news-panel-raised);
}

.news-light-pad::after {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 20px;
  height: 2px;
  background: var(--news-panel-accent);
  content: "";
  transform: rotate(var(--news-dial-angle));
  transform-origin: left center;
}

.news-light-values {
  display: grid;
  gap: 6px;
}

.news-light-values label {
  display: flex;
  align-items: center;
  border-radius: 7px;
  background: var(--news-panel-raised);
}

.news-light-values input {
  width: 100%;
  min-width: 0;
  padding: 8px 2px 8px 10px;
  border: 0;
  outline: 0;
  color: var(--news-panel-text);
  font: inherit;
  font-weight: 750;
  background: transparent;
}

.news-light-values label:focus-within,
.news-range-row input:focus-visible {
  outline: 2px solid var(--news-panel-accent);
  outline-offset: 2px;
}

.news-light-values label > span:last-child {
  padding-right: 9px;
  color: var(--news-panel-muted);
}

.news-glass-ranges {
  display: grid;
  gap: 8px;
}

.news-range-row {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr) 54px;
  align-items: center;
  gap: 0;
}

.news-range-row input[type="range"] {
  width: 100%;
  height: 32px;
  margin: 0;
  appearance: none;
  cursor: pointer;
  background: transparent;
}

.news-range-row input[type="range"]::-webkit-slider-runnable-track {
  height: 6px;
  border-radius: 999px;
  background:
    linear-gradient(
      90deg,
      var(--news-panel-accent) 0 var(--news-range-fill),
      var(--news-panel-track) var(--news-range-fill) 100%
    );
}

.news-range-row input[type="range"]::-webkit-slider-thumb {
  width: 16px;
  height: 16px;
  margin-top: -5px;
  border: 0;
  border-radius: 50%;
  appearance: none;
  background: var(--news-panel-thumb);
  box-shadow: 0 1px 5px rgb(0 0 0 / 35%);
}

.news-range-row output {
  min-height: 32px;
  padding: 7px 10px;
  border-left: 1px solid rgb(255 255 255 / 7%);
  border-radius: 0 7px 7px 0;
  color: var(--news-panel-text);
  font-weight: 750;
  background: var(--news-panel-raised);
}
```

Add equivalent Firefox rules:

```css
.news-range-row input[type="range"]::-moz-range-track {
  height: 6px;
  border-radius: 999px;
  background: var(--news-panel-track);
}

.news-range-row input[type="range"]::-moz-range-progress {
  height: 6px;
  border-radius: 999px;
  background: var(--news-panel-accent);
}

.news-range-row input[type="range"]::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border: 0;
  border-radius: 50%;
  background: var(--news-panel-thumb);
}
```

- [ ] **Step 6: Add responsive panel layout**

Inside `@media (max-width: 700px)` add:

```css
.news-mode-panel {
  width: 100%;
  padding: 12px;
}

.news-light-control {
  grid-template-columns: 76px 64px minmax(0, 1fr);
}

.news-range-row {
  grid-template-columns: 82px minmax(0, 1fr) 48px;
}
```

- [ ] **Step 7: Run contracts and targeted component tests**

Run:

```powershell
npm.cmd test -- --run src/test/news-liquid-bars.contract.test.ts src/pages/NewsPage.test.tsx src/components/news/GlassControlPanel.test.tsx src/components/news/newsGlassSettings.test.ts
```

Expected: all targeted tests PASS.

- [ ] **Step 8: Commit visual styling**

```powershell
git add frontend/src/styles/news.css frontend/src/test/news-liquid-bars.contract.test.ts
git commit -m "style(news): add glass instrument controls"
```

---

### Task 5: Verify the Complete News Experience

**Files:**
- Verify only; fix only files already listed if a check exposes a defect.

**Interfaces:**
- Consumes the completed News page.
- Produces a verified build with no News behavior regression.

- [ ] **Step 1: Run typecheck**

```powershell
cd frontend
npm.cmd run typecheck
```

Expected: exit code 0.

- [ ] **Step 2: Run the full frontend test suite**

```powershell
npm.cmd test -- --run
```

Expected: all test files and tests PASS.

- [ ] **Step 3: Build the production bundle**

```powershell
npm.cmd run build
```

Expected: Vite exits 0 and writes `frontend/dist`.

- [ ] **Step 4: Inspect desktop behavior at `/news`**

Verify:

- no background grid is visible;
- no white perimeter or thick white lower edge is visible;
- the top highlight stays localized;
- both preset buttons load all seven values;
- changing each input updates the glass immediately;
- news refresh, topic filters, and article links still work.

- [ ] **Step 5: Inspect the mobile breakpoint**

At a viewport narrower than 700px, verify the panel fits without horizontal
page overflow, each control remains operable, and the news list remains below
the demo.

- [ ] **Step 6: Commit only if verification required a repair**

```powershell
git add frontend/src/pages/NewsPage.tsx frontend/src/pages/NewsPage.test.tsx frontend/src/styles/news.css frontend/src/test/news-liquid-bars.contract.test.ts frontend/src/components/news
git commit -m "fix(news): finish glass control verification"
```
