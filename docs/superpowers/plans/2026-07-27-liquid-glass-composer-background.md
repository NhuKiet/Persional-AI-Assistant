# Liquid Glass Composer and Pastel Light Background Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Light theme the first-run default, give it a pearl-pastel canvas, and restyle every shared chat composer as a responsive liquid-glass capsule while preserving Dark theme and all composer behavior.

**Architecture:** Keep the existing theme contract (`data-theme` plus CSS custom properties) and the existing shared `.input-bar` class. Add reusable glass/canvas tokens in `base.css`, consume them in `chat.css`, and change only first-run theme selection in `useTheme.ts` and the pre-React FOUC script.

**Tech Stack:** React 18, TypeScript, hand-written CSS, Vitest, Testing Library, Vite.

## Global Constraints

- Light theme is the default only when `localStorage["king-theme"]` has no valid saved value.
- A saved `"light"` or `"dark"` preference always wins.
- Dark canvas styling remains unchanged; only shared composer material changes through dark-theme tokens.
- Do not change `InputBar` callbacks, keyboard behavior, mic behavior, upload behavior, streaming behavior, or model selection.
- Do not add a stylesheet, dependency, bitmap background, or `!important`.
- Preserve the import order in `frontend/src/styles.css`.
- Repeated visual values belong in `frontend/src/styles/base.css` tokens.
- Support 320px width, keyboard focus, `prefers-reduced-motion`, and a usable fallback without `backdrop-filter`.

---

## File Map

- `frontend/src/hooks/useTheme.ts`: chooses the initial theme and persists later user choices.
- `frontend/index.html`: applies the same theme choice before React to prevent FOUC.
- `frontend/src/test/useTheme.test.tsx`: proves first-run Light default and saved preference precedence.
- `frontend/src/styles/base.css`: owns canvas, glass, border, shadow, and theme-specific tokens.
- `frontend/src/styles/chat.css`: owns `.input-bar` and its controls across Home, Research, Tool, Coding, and PDF.
- `frontend/src/styles/responsive.css`: owns the narrow-width composer adjustment.
- `frontend/src/test/InputBar.test.tsx`: protects existing send/attach behavior and verifies the shared class contract.

### Task 1: Make Light theme the first-run default

**Files:**
- Modify: `frontend/src/test/useTheme.test.tsx`
- Modify: `frontend/src/hooks/useTheme.ts`
- Modify: `frontend/index.html`

**Interfaces:**
- Consumes: `localStorage["king-theme"]` with valid values `"light"` or `"dark"`.
- Produces: `useTheme(): { theme: "light" | "dark"; toggle: () => void }` and matching pre-render `document.documentElement.dataset.theme`.

- [ ] **Step 1: Replace the default-theme test and add explicit saved-Dark coverage**

In `frontend/src/test/useTheme.test.tsx`, replace the first test and expand the saved-preference coverage:

```tsx
it("mặc định light khi chưa có preference", () => {
  const { result } = renderHook(() => useTheme());
  expect(result.current.theme).toBe("light");
  expect(document.documentElement.dataset.theme).toBe("light");
});

it.each(["light", "dark"] as const)("đọc lại preference %s đã lưu", savedTheme => {
  localStorage.setItem("king-theme", savedTheme);
  const { result } = renderHook(() => useTheme());
  expect(result.current.theme).toBe(savedTheme);
  expect(document.documentElement.dataset.theme).toBe(savedTheme);
});
```

Keep the existing toggle test unchanged: it will now assert that the first toggle moves from Light to Dark.

- [ ] **Step 2: Run the focused test and confirm the new default assertion fails**

Run:

```bash
cd frontend
npm test -- --run src/test/useTheme.test.tsx
```

Expected: FAIL because `initialTheme()` can still return Dark when there is no saved preference.

- [ ] **Step 3: Simplify `initialTheme()` to a saved-value-or-Light rule**

Replace `initialTheme()` in `frontend/src/hooks/useTheme.ts` with:

```ts
function initialTheme(): Theme {
  const saved = localStorage.getItem(KEY);
  if (saved === "light" || saved === "dark") return saved;
  return "light";
}
```

Update the adjacent comment so it states that storage wins and Light is the first-run default. Remove the obsolete `prefers-color-scheme` wording.

- [ ] **Step 4: Make the no-FOUC script follow the identical rule**

In `frontend/index.html`, replace the decision inside the existing IIFE with:

```html
<script>
  // Apply the saved theme before React renders; first visit defaults to Light.
  // Keep this priority identical to initialTheme() in hooks/useTheme.ts.
  (function () {
    try {
      var t = localStorage.getItem("king-theme");
      if (t !== "light" && t !== "dark") t = "light";
      document.documentElement.dataset.theme = t;
    } catch (e) {
      document.documentElement.dataset.theme = "light";
    }
  })();
</script>
```

- [ ] **Step 5: Run theme tests**

Run:

```bash
cd frontend
npm test -- --run src/test/useTheme.test.tsx src/test/theme-toggle.test.tsx
```

Expected: both files PASS; the sidebar toggle still changes `data-theme`.

- [ ] **Step 6: Commit the theme-default slice**

```bash
git add frontend/index.html frontend/src/hooks/useTheme.ts frontend/src/test/useTheme.test.tsx
git commit -m "feat(theme): default new sessions to light"
```

### Task 2: Add the pearl-pastel Light canvas and glass tokens

**Files:**
- Modify: `frontend/src/styles/base.css`

**Interfaces:**
- Consumes: the existing `:root` and `:root[data-theme="light"]` token scopes.
- Produces: `--canvas-background`, `--composer-surface`, `--composer-highlight`, `--composer-edge`, `--composer-control`, `--composer-control-edge`, and `--composer-shadow`.

- [ ] **Step 1: Record the current CSS build baseline**

Run:

```bash
cd frontend
npm run build
```

Expected: PASS before CSS edits. If it fails, stop and record the pre-existing failure before changing styles.

- [ ] **Step 2: Add dark-theme-safe defaults to `:root`**

Add these tokens beside the existing glass tokens in `frontend/src/styles/base.css`:

```css
  --canvas-background: var(--bg);
  --composer-surface:
    linear-gradient(180deg, rgba(255, 255, 255, 0.105), rgba(255, 255, 255, 0.04)),
    rgba(8, 12, 18, 0.42);
  --composer-highlight: rgba(255, 255, 255, 0.17);
  --composer-edge: rgba(255, 255, 255, 0.20);
  --composer-control: rgba(255, 255, 255, 0.065);
  --composer-control-edge: rgba(255, 255, 255, 0.14);
  --composer-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.26),
    inset 0 -1px 0 rgba(255, 255, 255, 0.04),
    0 18px 48px rgba(0, 0, 0, 0.42);
```

These values change the composer material in Dark theme without changing the Dark canvas.

- [ ] **Step 3: Override the canvas and glass material in Light theme**

Add these values inside `:root[data-theme="light"]`:

```css
  --canvas-background:
    radial-gradient(58rem 34rem at 30% 34%, rgba(178, 224, 255, 0.50), transparent 68%),
    radial-gradient(54rem 31rem at 76% 72%, rgba(219, 235, 170, 0.44), transparent 70%),
    radial-gradient(30rem 24rem at 96% 16%, rgba(251, 222, 179, 0.22), transparent 74%),
    linear-gradient(145deg, #f9faf9, #edf2f2 52%, #f7f7f6);
  --composer-surface:
    linear-gradient(180deg, rgba(255, 255, 255, 0.64), rgba(255, 255, 255, 0.31)),
    rgba(232, 242, 244, 0.34);
  --composer-highlight: rgba(255, 255, 255, 0.82);
  --composer-edge: rgba(255, 255, 255, 0.86);
  --composer-control: rgba(255, 255, 255, 0.40);
  --composer-control-edge: rgba(255, 255, 255, 0.80);
  --composer-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.98),
    inset 0 -1px 0 rgba(100, 121, 132, 0.08),
    0 20px 50px rgba(75, 104, 117, 0.15),
    0 2px 8px rgba(70, 96, 108, 0.08);
```

The four literal base colors belong here because this is the token source of truth. Do not repeat them in downstream styles.

- [ ] **Step 4: Make the app canvas consume the new background token**

Change the existing `body` declaration from:

```css
body {
  background: var(--bg);
```

to:

```css
body {
  background: var(--canvas-background);
  background-attachment: fixed;
```

Keep all existing body text and font declarations. Reduce the existing `body::before` grain opacity in Light theme only:

```css
:root[data-theme="light"] body::before {
  opacity: 0.12;
}
```

- [ ] **Step 5: Build after the token and canvas change**

Run:

```bash
cd frontend
npm run build
```

Expected: PASS with no CSS parse warnings.

- [ ] **Step 6: Commit the canvas/token slice**

```bash
git add frontend/src/styles/base.css
git commit -m "feat(theme): add pearl pastel light canvas"
```

### Task 3: Restyle every shared composer as liquid glass

**Files:**
- Modify: `frontend/src/test/InputBar.test.tsx`
- Modify: `frontend/src/styles/chat.css`
- Modify: `frontend/src/styles/responsive.css`

**Interfaces:**
- Consumes: the composer tokens added in Task 2 and the existing `.input-bar` markup contract.
- Produces: one shared liquid-glass treatment used by `InputBar`, `CodingPage`, and `PdfAssistantPanel`.

- [ ] **Step 1: Add a contract test for the shared composer class**

Append this test to `frontend/src/test/InputBar.test.tsx`:

```tsx
it("dùng class input-bar làm contract giao diện dùng chung", () => {
  const { container } = render(
    <InputBar onSend={() => {}} streaming={false} onStop={() => {}} />
  );
  expect(container.firstElementChild).toHaveClass("input-bar");
});
```

This protects the shared selector relied on by Home, Research, Tool, Coding, and PDF styling.

- [ ] **Step 2: Run the focused component test**

Run:

```bash
cd frontend
npm test -- --run src/test/InputBar.test.tsx
```

Expected: PASS. This is a characterization test: CSS is about to change, but behavior and the shared DOM contract must remain stable.

- [ ] **Step 3: Replace the `.input-bar` surface and focus rules**

In `frontend/src/styles/chat.css`, replace the existing `.input-bar` and `.input-bar:focus-within` declarations with:

```css
.input-bar {
  position: relative;
  isolation: isolate;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  min-height: 54px;
  padding: 8px;
  border: 1px solid var(--composer-edge);
  border-radius: 999px;
  background: var(--composer-surface);
  box-shadow: var(--composer-shadow);
  backdrop-filter: blur(28px) saturate(170%);
  -webkit-backdrop-filter: blur(28px) saturate(170%);
  transition:
    border-color var(--dur) var(--ease),
    box-shadow var(--dur) var(--ease);
}

.input-bar::before {
  content: "";
  position: absolute;
  z-index: -1;
  inset: 1px 8% 48%;
  border-radius: inherit;
  background: radial-gradient(ellipse at 50% 0%, var(--composer-highlight), transparent 72%);
  filter: blur(5px);
  pointer-events: none;
}

.input-bar:focus-within {
  border-color: color-mix(in srgb, var(--accent) 48%, var(--composer-edge));
  box-shadow:
    var(--composer-shadow),
    0 0 0 3px color-mix(in srgb, var(--accent) 8%, transparent),
    0 0 32px color-mix(in srgb, var(--accent) 10%, transparent);
}
```

Do not add `overflow: hidden`; the nested ModelPicker dropdown must remain unclipped.

- [ ] **Step 4: Give composer controls the same glass material**

Replace the visual parts of `.input-attach` and `.mic-btn` while keeping their sizing, layout, cursor, disabled, and active behavior:

```css
.input-attach,
.mic-btn {
  border: 1px solid var(--composer-control-edge);
  background: var(--composer-control);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--composer-highlight) 68%, transparent);
}

.input-attach:hover,
.mic-btn:hover:not(:disabled) {
  color: var(--text);
  border-color: color-mix(in srgb, var(--accent) 28%, var(--composer-control-edge));
  background: color-mix(in srgb, var(--composer-control) 82%, var(--accent-soft));
}

.input-bar .mp-trigger {
  border-color: var(--composer-control-edge);
  background: var(--composer-control);
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--composer-highlight) 68%, transparent);
}
```

Keep `.mic-btn-active` after these rules so its accent state wins by order.

- [ ] **Step 5: Polish the send button without overriding its inline accent**

Update `.input-send` so the background supplied by each page remains the source of accent color:

```css
.input-send {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--composer-highlight) 72%, transparent);
  cursor: pointer;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.62),
    0 6px 18px color-mix(in srgb, var(--accent) 22%, transparent);
  transition:
    filter var(--dur) var(--ease),
    transform var(--dur) var(--ease),
    box-shadow var(--dur) var(--ease);
}
```

Retain the existing hover and disabled selectors. Do not introduce a CSS `background`, because `InputBar`, Coding, and PDF already supply context-specific inline accent backgrounds.

- [ ] **Step 6: Add the narrow-width adjustment**

Inside the existing `@media (max-width: 700px)` block in `frontend/src/styles/responsive.css`, add:

```css
  .input-bar {
    gap: 5px;
    padding: 7px;
  }

  .input-bar .mp-trigger {
    max-width: 132px;
  }
```

Do not hide actions or reduce the textarea font size.

- [ ] **Step 7: Run behavior tests and the full frontend verification suite**

Run:

```bash
cd frontend
npm test -- --run src/test/InputBar.test.tsx src/test/useTheme.test.tsx src/test/theme-toggle.test.tsx
npm run typecheck
npm run build
```

Expected: all tests PASS, TypeScript exits 0, and Vite build exits 0.

- [ ] **Step 8: Verify the runtime visually**

Start:

```bash
cd frontend
npm run dev
```

In the browser, clear `localStorage["king-theme"]`, reload, and confirm:

- Home opens in Light theme with the pearl-pastel canvas.
- Clicking into the Home composer shows a teal focus edge without layout movement.
- ModelPicker opens outside the capsule without clipping.
- Research and a non-teal tool show the same material and retain their accent.
- Coding and PDF use the same liquid-glass capsule.
- At 320px width, the composer fits without horizontal overflow.
- Switching to Dark preserves the existing dark canvas while the composer remains liquid glass.
- Reload after selecting Dark preserves Dark.

- [ ] **Step 9: Commit the composer slice**

```bash
git add frontend/src/styles/chat.css frontend/src/styles/responsive.css frontend/src/test/InputBar.test.tsx
git commit -m "feat(chat): apply liquid glass composer styling"
```

### Task 4: Final regression and design review

**Files:**
- Verify only; modify the preceding files only if a regression is found.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: a verified feature ready for integration.

- [ ] **Step 1: Run the complete frontend suite**

Run:

```bash
cd frontend
npm test
npm run typecheck
npm run build
```

Expected: every Vitest test passes, TypeScript exits 0, and Vite produces `dist/`.

- [ ] **Step 2: Inspect the final diff for scope and CSS architecture**

Run:

```bash
git diff --check HEAD~3..HEAD
git diff --stat HEAD~3..HEAD
git diff HEAD~3..HEAD -- frontend/index.html frontend/src/hooks/useTheme.ts frontend/src/test/useTheme.test.tsx frontend/src/styles/base.css frontend/src/styles/chat.css frontend/src/styles/responsive.css frontend/src/test/InputBar.test.tsx
```

Expected:

- No whitespace errors.
- No stylesheet import changes.
- No new dependency.
- No `!important`.
- No unrelated application logic changes.

- [ ] **Step 3: Record visual evidence**

Capture one desktop Light-theme screenshot and one narrow-panel or 320px screenshot. Check them against the approved mockup for:

- pearl-white canvas;
- broad, soft blue and yellow-green glows;
- curved top highlight on the composer;
- readable placeholder and controls;
- visible focus state;
- no clipping or stacking errors.

- [ ] **Step 4: Create a final fixup commit only if verification required changes**

If a verification fix was necessary:

```bash
git add frontend/index.html frontend/src/hooks/useTheme.ts frontend/src/test/useTheme.test.tsx frontend/src/styles/base.css frontend/src/styles/chat.css frontend/src/styles/responsive.css frontend/src/test/InputBar.test.tsx
git commit -m "fix(ui): resolve liquid glass verification findings"
```

If no files changed, do not create an empty commit.
