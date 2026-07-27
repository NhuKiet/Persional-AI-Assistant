# App-wide Pearl Aurora Glass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Pearl Aurora canvas visible across the whole app and apply a coherent primary/secondary Liquid Glass material to composers, Home actions, and Home suggestions in both themes.

**Architecture:** Keep the existing `data-theme` and plain-CSS token architecture. Define all new shared material values in `base.css`, let the full-viewport app shell and sidebar reveal/frost the body canvas, and consume the secondary-glass tokens in the existing `chat.css` selectors. Dense work panels retain their current readability-first fills.

**Tech Stack:** React 18, TypeScript, hand-written CSS, Vitest, Testing Library, Vite.

## Global Constraints

- Preserve the import order in `frontend/src/styles.css`.
- Do not add a stylesheet, dependency, bitmap background, or new `!important`.
- Repeated visual values belong in `frontend/src/styles/base.css`.
- Light remains the first-run default; valid stored Light/Dark preferences continue to win.
- Preserve all chat, navigation, model, upload, microphone, streaming, and keyboard behavior.
- Dark remains dark; its aurora glows must stay subdued.
- Do not animate `filter`, `backdrop-filter`, layout properties, or long-running shadows.
- Use existing motion tokens and retain the global `prefers-reduced-motion` fallback.
- Support 320px without clipping or horizontal overflow.
- Do not stage or modify the unrelated existing change in `backend/app/main.py`.

---

## File Map

- `frontend/src/styles/base.css`
  - Owns Dark/Light canvas, shell-frost, primary composer, and secondary-glass tokens.
- `frontend/src/styles/coding.css`
  - Owns `.app-layout`; stops the full-viewport shell from covering the body canvas.
- `frontend/src/styles/sidebar.css`
  - Owns `.sidebar`; changes it from an opaque panel to an ambient frosted shell.
- `frontend/src/styles/pdf.css`
  - Owns `.pdf-workspace-body`; reveals the shared canvas while keeping the three inner work panels readability-first.
- `frontend/src/styles/chat.css`
  - Owns `.input-bar`, `.dock-item`, and `.suggestion-card`; applies the approved material hierarchy.
- `frontend/src/styles/responsive.css`
  - Owns the mobile breakpoint; reduces tile lift and confirms glass layouts fit at 320px.
- `frontend/src/test/liquidGlassTheme.contract.test.ts`
  - Protects the shared token and selector ownership contract without coupling to exact color values.

### Task 1: Establish an app-wide canvas and frosted structural shell

**Files:**
- Create: `frontend/src/test/liquidGlassTheme.contract.test.ts`
- Modify: `frontend/src/styles/base.css`
- Modify: `frontend/src/styles/coding.css`
- Modify: `frontend/src/styles/sidebar.css`
- Modify: `frontend/src/styles/pdf.css`

**Interfaces:**
- Consumes: `html[data-theme="light"|"dark"]`, `body { background: var(--canvas-background) }`.
- Produces: `--shell-surface`, `--shell-edge`, `--shell-blur`, plus transparent `.app-layout` and `.pdf-workspace-body`.

- [ ] **Step 1: Add failing CSS ownership tests**

Create `frontend/src/test/liquidGlassTheme.contract.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readStyle = (name: string) =>
  readFileSync(new URL(`../styles/${name}`, import.meta.url), "utf8");

describe("Pearl Aurora Glass CSS contract", () => {
  it("defines shared shell and secondary-glass tokens in base.css", () => {
    const css = readStyle("base.css");

    expect(css).toMatch(/--shell-surface\s*:/);
    expect(css).toMatch(/--shell-edge\s*:/);
    expect(css).toMatch(/--shell-blur\s*:/);
    expect(css).toMatch(/--secondary-glass-surface\s*:/);
    expect(css).toMatch(/--secondary-glass-edge\s*:/);
  });

  it("does not cover the app-wide canvas with opaque outer shells", () => {
    const coding = readStyle("coding.css");
    const pdf = readStyle("pdf.css");
    const sidebar = readStyle("sidebar.css");

    expect(coding).toMatch(/\.app-layout\s*\{[^}]*background:\s*transparent;/s);
    expect(pdf).toMatch(/\.pdf-workspace-body\s*\{[^}]*background:\s*transparent;/s);
    expect(sidebar).toMatch(/\.sidebar\s*\{[^}]*background:\s*var\(--shell-surface\);/s);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```powershell
Set-Location frontend
npm test -- --run src/test/liquidGlassTheme.contract.test.ts
```

Expected: FAIL because the shell/secondary-glass tokens are absent and the outer shells still use opaque backgrounds.

- [ ] **Step 3: Add Dark canvas and structural glass tokens**

In the `:root` design-token block of `frontend/src/styles/base.css`, replace the current `--canvas-background: var(--bg);` and add the structural/secondary material tokens beside the existing glass tokens:

```css
  --canvas-background:
    radial-gradient(64rem 42rem at 24% 8%, rgba(77, 117, 153, 0.13), transparent 64%),
    radial-gradient(58rem 40rem at 82% 76%, rgba(30, 209, 194, 0.07), transparent 66%),
    radial-gradient(38rem 30rem at 91% 12%, rgba(115, 87, 156, 0.07), transparent 70%),
    linear-gradient(145deg, #07080b, #090c12 52%, #07090d);
  --shell-surface: rgba(8, 11, 16, 0.54);
  --shell-edge: rgba(255, 255, 255, 0.09);
  --shell-blur: blur(24px) saturate(145%);
  --secondary-glass-surface:
    linear-gradient(155deg, rgba(255, 255, 255, 0.11), transparent 54%),
    linear-gradient(180deg, transparent, rgba(95, 140, 170, 0.045)),
    rgba(255, 255, 255, 0.035);
  --secondary-glass-edge: rgba(255, 255, 255, 0.16);
  --secondary-glass-highlight: rgba(255, 255, 255, 0.22);
  --secondary-glass-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.19),
    inset 0 -1px 0 rgba(255, 255, 255, 0.025),
    0 10px 28px rgba(0, 0, 0, 0.24);
```

Keep all literals inside `base.css`; downstream files must only consume tokens.

- [ ] **Step 4: Add Light structural and secondary-glass overrides**

Inside `:root[data-theme="light"]` in `frontend/src/styles/base.css`, retain the approved pearl canvas and add:

```css
  --shell-surface: rgba(247, 251, 252, 0.48);
  --shell-edge: rgba(255, 255, 255, 0.72);
  --secondary-glass-surface:
    linear-gradient(155deg, rgba(255, 255, 255, 0.55), transparent 54%),
    linear-gradient(180deg, transparent, rgba(178, 224, 255, 0.10)),
    rgba(242, 249, 250, 0.27);
  --secondary-glass-edge: rgba(255, 255, 255, 0.78);
  --secondary-glass-highlight: rgba(255, 255, 255, 0.72);
  --secondary-glass-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.94),
    inset 0 -1px 0 rgba(83, 112, 126, 0.07),
    0 12px 30px rgba(72, 105, 119, 0.11);
```

- [ ] **Step 5: Reveal the canvas through the outer app shell**

In `frontend/src/styles/coding.css`, change only the background line inside `.app-layout`:

```css
.app-layout {
  display: flex;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background: transparent;
}
```

In `frontend/src/styles/sidebar.css`, update `.sidebar`:

```css
.sidebar {
  width: 240px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--shell-surface);
  border-right: 1px solid var(--shell-edge);
  backdrop-filter: var(--shell-blur);
  -webkit-backdrop-filter: var(--shell-blur);
  transition: width var(--dur-slow) var(--ease),
              opacity var(--dur) var(--ease);
  overflow: hidden;
}
```

This also replaces the two raw transition durations with existing tokens.

- [ ] **Step 6: Reveal the canvas around PDF working panels**

In `.pdf-workspace-body` in `frontend/src/styles/pdf.css`, replace only:

```css
  background: var(--bg);
```

with:

```css
  background: transparent;
```

Keep `.pdf-outline-panel`, `.pdf-viewer-panel`, and `.pdf-assistant-panel` unchanged so document reading and assistant text retain stable contrast.

- [ ] **Step 7: Run focused tests, typecheck, and build**

Run:

```powershell
Set-Location frontend
npm test -- --run src/test/liquidGlassTheme.contract.test.ts src/test/theme-toggle.test.tsx src/test/useTheme.test.tsx
npm run typecheck
npm run build
```

Expected: all focused tests PASS, TypeScript exits 0, and Vite produces `dist/`.

- [ ] **Step 8: Commit the app-shell slice**

Run from the repository root:

```powershell
git add frontend/src/test/liquidGlassTheme.contract.test.ts frontend/src/styles/base.css frontend/src/styles/coding.css frontend/src/styles/sidebar.css frontend/src/styles/pdf.css
git commit -m "feat(theme): reveal pearl aurora canvas app-wide"
```

Confirm `backend/app/main.py` is not staged.

### Task 2: Refine the primary composer material in both themes

**Files:**
- Modify: `frontend/src/test/liquidGlassTheme.contract.test.ts`
- Modify: `frontend/src/styles/base.css`
- Modify: `frontend/src/styles/chat.css`

**Interfaces:**
- Consumes: the existing `--composer-accent` contextual accent contract.
- Produces: `--composer-specular`, `--composer-blur`, and a more translucent Light/Dark `.input-bar`.

- [ ] **Step 1: Extend the contract test for the new primary-glass tokens**

Add this test inside the existing `describe` block:

```ts
  it("keeps composer optics tokenized and consumed by chat.css", () => {
    const base = readStyle("base.css");
    const chat = readStyle("chat.css");

    expect(base).toMatch(/--composer-specular\s*:/);
    expect(base).toMatch(/--composer-blur\s*:/);
    expect(chat).toMatch(/background:\s*var\(--composer-specular\);/);
    expect(chat).toMatch(/backdrop-filter:\s*var\(--composer-blur\);/);
  });
```

- [ ] **Step 2: Run the test and confirm the new assertions fail**

Run:

```powershell
Set-Location frontend
npm test -- --run src/test/liquidGlassTheme.contract.test.ts
```

Expected: FAIL because `--composer-specular` and `--composer-blur` do not exist.

- [ ] **Step 3: Tokenize and tune the Dark composer optics**

In `:root` in `frontend/src/styles/base.css`, update the composer block to:

```css
  --composer-surface:
    linear-gradient(180deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.052)),
    rgba(8, 12, 18, 0.36);
  --composer-specular:
    radial-gradient(ellipse at 50% 0%, rgba(255, 255, 255, 0.27), transparent 72%);
  --composer-blur: blur(30px) saturate(175%);
  --composer-highlight: rgba(255, 255, 255, 0.24);
  --composer-edge: rgba(255, 255, 255, 0.31);
  --composer-control: rgba(255, 255, 255, 0.075);
  --composer-control-edge: rgba(255, 255, 255, 0.16);
  --composer-control-inset: inset 0 1px 0 color-mix(in srgb, var(--composer-highlight) 68%, transparent);
  --composer-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.34),
    inset 0 -1px 0 rgba(255, 255, 255, 0.045),
    0 20px 52px rgba(0, 0, 0, 0.38),
    0 0 30px color-mix(in srgb, var(--composer-accent, var(--accent)) 8%, transparent);
```

The root token must use `var(--composer-accent, var(--accent))` so consumers without an inline contextual accent still render correctly.

- [ ] **Step 4: Tune the Light composer to reveal the canvas**

Inside `:root[data-theme="light"]`, replace the composer material values with:

```css
  --composer-surface:
    linear-gradient(180deg, rgba(255, 255, 255, 0.50), rgba(255, 255, 255, 0.20)),
    rgba(226, 242, 245, 0.22);
  --composer-specular:
    radial-gradient(ellipse at 50% 0%, rgba(255, 255, 255, 0.88), transparent 72%);
  --composer-highlight: rgba(255, 255, 255, 0.88);
  --composer-edge: rgba(255, 255, 255, 0.82);
  --composer-control: rgba(255, 255, 255, 0.33);
  --composer-control-edge: rgba(255, 255, 255, 0.76);
  --composer-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.98),
    inset 0 -1px 0 rgba(78, 110, 125, 0.08),
    0 22px 52px rgba(68, 103, 119, 0.13),
    0 0 32px color-mix(in srgb, var(--composer-accent, var(--accent)) 7%, transparent);
```

`--composer-blur` inherits the shared value because both themes use the same blur geometry.

- [ ] **Step 5: Consume the optic tokens in the shared composer**

In `.input-bar` in `frontend/src/styles/chat.css`, replace both hard-coded filter declarations:

```css
  backdrop-filter: var(--composer-blur);
  -webkit-backdrop-filter: var(--composer-blur);
```

In `.input-bar::before`, replace its background declaration:

```css
  background: var(--composer-specular);
```

Keep `overflow` unset so ModelPicker remains unclipped.

- [ ] **Step 6: Run composer behavior and CSS contract tests**

Run:

```powershell
Set-Location frontend
npm test -- --run src/test/liquidGlassTheme.contract.test.ts src/test/InputBar.test.tsx src/test/MicButton.test.tsx
npm run typecheck
npm run build
```

Expected: all tests PASS, TypeScript exits 0, and Vite build exits 0.

- [ ] **Step 7: Commit the primary-glass slice**

Run from the repository root:

```powershell
git add frontend/src/test/liquidGlassTheme.contract.test.ts frontend/src/styles/base.css frontend/src/styles/chat.css
git commit -m "feat(chat): refine pearl liquid composer"
```

### Task 3: Apply secondary Liquid Glass to Home actions and suggestions

**Files:**
- Modify: `frontend/src/test/liquidGlassTheme.contract.test.ts`
- Modify: `frontend/src/styles/chat.css`
- Modify: `frontend/src/styles/responsive.css`

**Interfaces:**
- Consumes: `--secondary-glass-surface`, `--secondary-glass-edge`, `--secondary-glass-highlight`, `--secondary-glass-shadow`, and per-tool `--tint`.
- Produces: secondary glass on `.dock-item` and `.suggestion-card`.

- [ ] **Step 1: Add failing consumption tests for secondary glass**

Add this test inside the existing `describe` block:

```ts
  it("applies the secondary material to Home actions and suggestions", () => {
    const chat = readStyle("chat.css");

    expect(chat).toMatch(/\.suggestion-card\s*\{[^}]*background:\s*var\(--secondary-glass-surface\);/s);
    expect(chat).toMatch(/\.dock-item\s*\{[^}]*background:\s*var\(--secondary-glass-surface\);/s);
    expect(chat).toMatch(/\.suggestion-card::before/);
    expect(chat).toMatch(/\.dock-item::before/);
  });
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```powershell
Set-Location frontend
npm test -- --run src/test/liquidGlassTheme.contract.test.ts
```

Expected: FAIL because the Home tiles still consume `--glass`.

- [ ] **Step 3: Restyle `.suggestion-card` with the secondary material**

In `frontend/src/styles/chat.css`, change the surface-related declarations in `.suggestion-card` to:

```css
.suggestion-card {
  background: var(--secondary-glass-surface);
  backdrop-filter: var(--blur);
  -webkit-backdrop-filter: var(--blur);
  border: 1px solid var(--secondary-glass-edge);
  border-radius: var(--r);
  box-shadow: var(--secondary-glass-shadow);
  overflow: hidden;
  padding: 14px 16px 14px 14px;
  text-align: left;
  color: var(--text2);
  font-family: var(--sans);
  font-size: 13px;
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease),
              color var(--dur-fast) var(--ease),
              transform var(--dur-fast) var(--ease),
              box-shadow var(--dur-fast) var(--ease);
  position: relative;
  line-height: 1.4;
}

.suggestion-card::before {
  content: "";
  position: absolute;
  inset: 1px 12% auto;
  height: 14px;
  border-radius: 999px;
  background: radial-gradient(ellipse at center, var(--secondary-glass-highlight), transparent 74%);
  filter: blur(5px);
  opacity: 0.7;
  pointer-events: none;
}

.suggestion-card > * {
  position: relative;
  z-index: 1;
}

.suggestion-card:hover {
  border-color: color-mix(in srgb, var(--accent) 38%, var(--secondary-glass-edge));
  color: var(--text);
  transform: translateY(-1px);
  box-shadow:
    var(--secondary-glass-shadow),
    0 14px 32px color-mix(in srgb, var(--accent) 8%, transparent);
}
```

Retain the existing `:focus-visible`, `.suggestion-arrow`, and arrow hover rules after this block.

- [ ] **Step 4: Restyle `.dock-item` while preserving the tool tint**

In `.dock-item`, replace the current surface and hover declarations with:

```css
.dock-item {
  --tint: var(--accent);
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  background: var(--secondary-glass-surface);
  backdrop-filter: var(--blur);
  -webkit-backdrop-filter: var(--blur);
  border: 1px solid var(--secondary-glass-edge);
  border-radius: 14px;
  box-shadow: var(--secondary-glass-shadow);
  padding: 10px 14px 8px;
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease),
              transform var(--dur-fast) var(--ease),
              box-shadow var(--dur-fast) var(--ease);
  min-width: 72px;
}

.dock-item::before {
  content: "";
  position: absolute;
  inset: 1px 16% auto;
  height: 13px;
  border-radius: 999px;
  background: radial-gradient(ellipse at center, var(--secondary-glass-highlight), transparent 74%);
  filter: blur(5px);
  opacity: 0.68;
  pointer-events: none;
}

.dock-item:hover {
  border-color: color-mix(in srgb, var(--tint) 42%, var(--secondary-glass-edge));
  transform: translateY(-1px);
  box-shadow:
    var(--secondary-glass-shadow),
    0 14px 30px color-mix(in srgb, var(--tint) 9%, transparent);
}
```

Retain `.dock-item::after` as the tool-color hover glow and keep `.dock-icon`/`.dock-label` above both pseudo-elements with their existing `z-index: 1`.

- [ ] **Step 5: Add a reduced-lift mobile override**

Inside `@media (max-width: 700px)` in `frontend/src/styles/responsive.css`, add:

```css
  .dock-item:hover,
  .suggestion-card:hover {
    transform: none;
  }
```

The existing global reduced-motion rule remains unchanged.

- [ ] **Step 6: Run Home and CSS contract tests**

Run:

```powershell
Set-Location frontend
npm test -- --run src/test/liquidGlassTheme.contract.test.ts src/test/app.smoke.test.jsx src/test/routes.contract.test.jsx
npm run typecheck
npm run build
```

Expected: all tests PASS, TypeScript exits 0, and Vite build exits 0.

- [ ] **Step 7: Commit the secondary-glass slice**

Run from the repository root:

```powershell
git add frontend/src/test/liquidGlassTheme.contract.test.ts frontend/src/styles/chat.css frontend/src/styles/responsive.css
git commit -m "feat(home): extend liquid glass to action tiles"
```

### Task 4: Browser verification and final regression

**Files:**
- Verify: `frontend/src/styles/base.css`
- Verify: `frontend/src/styles/chat.css`
- Verify: `frontend/src/styles/coding.css`
- Verify: `frontend/src/styles/sidebar.css`
- Verify: `frontend/src/styles/pdf.css`
- Verify: `frontend/src/styles/responsive.css`
- Modify only the owning file above when a verified defect is found.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: a visually verified feature branch ready for review and merge.

- [ ] **Step 1: Start the frontend using the configured development command**

Run:

```powershell
Set-Location frontend
npm run dev
```

Expected: Vite prints a local URL and serves the application without startup errors.

- [ ] **Step 2: Verify the approved Home composition in Light**

At desktop width, clear `localStorage["king-theme"]`, reload, and confirm:

- the pearl blue/yellow-green/violet canvas reaches behind both sidebar and main content;
- the composer reveals canvas color and has a visible upper specular band;
- the six dock actions and four suggestions read as secondary glass;
- text and icon contrast remain clear;
- ModelPicker opens outside the composer without clipping.

Capture a screenshot for review.

- [ ] **Step 3: Verify Dark without turning it into neon**

Switch to Dark and confirm:

- the canvas remains predominantly near-black;
- blue/teal/violet variation is visible only as restrained atmosphere;
- the composer reads as milky charcoal glass rather than a black pill;
- dock and suggestion tiles remain subordinate to the composer;
- contextual tool accents remain unchanged.

Capture a screenshot for review.

- [ ] **Step 4: Verify working pages and structural transparency**

Open Research, Coding, PDF, and one additional tool page. Confirm:

- the outer canvas remains continuous;
- opaque inner code/PDF/result panels remain readable;
- sidebar text and controls remain readable over frost;
- PDF viewer, outline, and assistant panels retain their current contrast;
- no overlay, menu, dropdown, or panel is clipped.

- [ ] **Step 5: Verify responsive and reduced-motion paths**

At 320px width, confirm no horizontal overflow, composer controls remain usable, and Home tiles fit. Emulate `prefers-reduced-motion: reduce` and confirm tile hover movement is effectively removed while focus states remain visible.

- [ ] **Step 6: Run the complete frontend suite**

Stop the dev server, then run:

```powershell
Set-Location frontend
npm test
npm run typecheck
npm run build
```

Expected: every Vitest test passes, TypeScript exits 0, and Vite produces `dist/`.

- [ ] **Step 7: Inspect the complete feature diff**

Run from the repository root:

```powershell
git diff --check develop...HEAD
git diff --stat develop...HEAD
git diff develop...HEAD -- frontend/src/test/liquidGlassTheme.contract.test.ts frontend/src/styles/base.css frontend/src/styles/chat.css frontend/src/styles/coding.css frontend/src/styles/sidebar.css frontend/src/styles/pdf.css frontend/src/styles/responsive.css
git status --short
```

Expected:

- no whitespace errors;
- no import-order change;
- no new dependency or stylesheet;
- no new `!important`;
- `backend/app/main.py` remains an unrelated unstaged user change;
- only the approved UI and contract-test files appear in the feature diff.

- [ ] **Step 8: Commit only verified corrections**

If browser or regression verification required corrections, run:

```powershell
git add frontend/src/test/liquidGlassTheme.contract.test.ts frontend/src/styles/base.css frontend/src/styles/chat.css frontend/src/styles/coding.css frontend/src/styles/sidebar.css frontend/src/styles/pdf.css frontend/src/styles/responsive.css
git commit -m "fix(ui): resolve pearl aurora verification findings"
```

If verification produced no source changes, leave the existing three implementation commits unchanged.
