# News Liquid Bars Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild only the News command bar and topic-tab bars so they match the supplied white liquid-glass reference before any further card work.

**Architecture:** Keep `NewsPage` behavior and markup semantics intact. Add two shallow presentational wrappers, `.news-command-shell` and `.news-tab-shell`, then use `news.css` to build the glass objects from layered pseudo-elements: outer rim, inner rim, frosted fill, specular band, and grounded shadow. The page background and article-card styling are explicitly out of scope for this pass.

**Tech Stack:** React 18, TypeScript, Vitest + Testing Library, hand-written CSS, existing app font and motion tokens.

## Visual reference and non-negotiable geometry

The supplied reference has two independent families of objects:

1. **Command bar** — one wide, low pill occupying almost the full content width; 76px tall at desktop. It has a bright double rim, a quiet translucent fill, an inset top highlight, a soft diffuse shadow, a raised square back button on the left, and a raised refresh pill on the right.
2. **Topic bars** — five separate, evenly spaced compact capsules below it. Each is 172px × 52px at desktop. The active capsule uses a cyan→blue liquid fill; inactive capsules are almost-white glass. They are not plain rounded buttons on a flat page.

The first implementation attempt failed because it treated these as one generic `background + border + shadow` rule. This pass must build the layers separately and must not alter the article card layout to compensate.

## Global Constraints

- Modify only `frontend/src/pages/NewsPage.tsx`, `frontend/src/pages/NewsPage.test.tsx`, and `frontend/src/styles/news.css`.
- Do not change `useNews`, API calls, topic IDs, external links, article assets, background scene asset, or global theme tokens.
- Keep `/news` white in either application theme.
- Do not change `frontend/src/styles.css` import order.
- Use `--news-*` variables local to `.news-page`; existing global `--dur-fast`, `--dur`, `--ease`, and `--ease-out` remain the sole motion values.
- Never use `transition: all`, an infinite animation, an SVG replacement, or an external image asset for the bars.
- The command bar and tab labels remain real HTML controls with the current accessible names and keyboard behavior.

---

### Task 1: Add stable structural hooks for the two glass-object families

**Files:**
- Modify: `frontend/src/pages/NewsPage.tsx`
- Modify: `frontend/src/pages/NewsPage.test.tsx`

**Interfaces:**
- Consumes: existing `TOPIC_TABS`, `topic`, `setTopic`, `refresh`, and `navigate` bindings.
- Produces: `.news-command-shell`, `.news-command-bar`, `.news-tab-shell`, `.news-tab-row`, and `.news-tab-active` hooks consumed by Task 2.

- [ ] **Step 1: Write the failing structure test**

Add this exact test:

```tsx
it("groups the command controls and topic controls into independent liquid-bar shells", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    jsonResponse({ items: [SAMPLE_ITEM], limit: 20, offset: 0, has_more: false }),
  ));
  const { container } = renderPage();

  await screen.findByRole("button", { name: /Làm mới/i });
  expect(container.querySelector(".news-command-shell > .news-command-bar")).not.toBeNull();
  expect(container.querySelector(".news-tab-shell > .news-tab-row")).not.toBeNull();
  expect(container.querySelectorAll(".news-tab-row .news-tab")).toHaveLength(5);
});
```

- [ ] **Step 2: Verify the test fails**

Run: `npx.cmd vitest run src/pages/NewsPage.test.tsx`

Expected: FAIL because the current page has `.news-header` and `.news-tabs` directly, not the two required shells.

- [ ] **Step 3: Add the minimal semantic wrappers**

Replace the current header with this shape while preserving its buttons, title, handlers, and labels:

```tsx
<div className="news-command-shell">
  <header className="news-header news-command-bar">
    {/* existing back button, h1, refresh button */}
  </header>
</div>
```

Replace the current nav with:

```tsx
<div className="news-tab-shell">
  <nav className="news-tabs news-tab-row" aria-label="Chủ đề tin tức">
    {/* existing topic buttons */}
  </nav>
</div>
```

- [ ] **Step 4: Verify the structural contract passes**

Run: `npx.cmd vitest run src/pages/NewsPage.test.tsx`

Expected: all existing News tests plus the new grouping test pass.

- [ ] **Step 5: Commit the structural hooks**

```powershell
git add frontend/src/pages/NewsPage.tsx frontend/src/pages/NewsPage.test.tsx
git commit -m "refactor(news): separate liquid bar shells"
```

### Task 2: Build the command bar as a layered glass object

**Files:**
- Modify: `frontend/src/styles/news.css`
- Modify: `frontend/src/pages/NewsPage.test.tsx`

**Interfaces:**
- Consumes: `.news-command-shell` and `.news-command-bar` from Task 1.
- Produces: `--news-bar-rim`, `--news-bar-shadow`, and layered command-bar CSS consumed only within News.

- [ ] **Step 1: Write the failing visual-contract test**

Add a DOM-level test that checks the bar exposes the modifier used to disable generic card styling:

```tsx
it("identifies the header as the dedicated command glass bar", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    jsonResponse({ items: [SAMPLE_ITEM], limit: 20, offset: 0, has_more: false }),
  ));
  renderPage();

  expect(await screen.findByRole("banner")).toHaveClass("news-command-bar");
});
```

If `header` does not expose the `banner` role in the test environment, add `role="banner"` to the existing `header`; do not change its heading or button semantics.

- [ ] **Step 2: Verify the test fails before the role/class contract exists**

Run: `npx.cmd vitest run src/pages/NewsPage.test.tsx`

Expected: FAIL until the `header` exposes `role="banner"` and `news-command-bar`.

- [ ] **Step 3: Define the local material tokens and command-bar layers**

Inside `.news-page`, add exactly these local tokens:

```css
--news-bar-rim: rgba(255, 255, 255, 0.96);
--news-bar-edge: rgba(143, 160, 199, 0.34);
--news-bar-fill: rgba(249, 252, 255, 0.62);
--news-bar-shadow: 0 18px 34px rgba(102, 126, 181, 0.2);
```

Make `.news-command-shell` the width constraint and `.news-command-bar` the material object. The command bar must have `min-height: 76px`, `border-radius: 28px`, a normal `border` using `--news-bar-edge`, and a multi-layer `box-shadow` with both `inset 0 1px 0 var(--news-bar-rim)` and `var(--news-bar-shadow)`.

Add two non-interactive pseudo-layers:

```css
.news-command-bar::before {
  position: absolute;
  inset: 2px;
  border: 1px solid rgba(255, 255, 255, 0.76);
  border-radius: inherit;
  content: "";
  pointer-events: none;
}

.news-command-bar::after {
  position: absolute;
  top: 1px;
  right: 17%;
  left: 18%;
  height: 22px;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.74), transparent);
  content: "";
  opacity: 0.74;
  pointer-events: none;
}
```

Set the header content to `position: relative; z-index: 1`. The back and refresh controls use the same rim/edge/fill layers but with a 20px radius, so they visually sit above the bar rather than dissolve into it.

- [ ] **Step 4: Verify the command-bar contract passes**

Run: `npx.cmd vitest run src/pages/NewsPage.test.tsx; npx.cmd tsc --noEmit`

Expected: all News tests pass and TypeScript exits 0.

- [ ] **Step 5: Commit the command bar**

```powershell
git add frontend/src/styles/news.css frontend/src/pages/NewsPage.test.tsx frontend/src/pages/NewsPage.tsx
git commit -m "feat(news): build layered liquid command bar"
```

### Task 3: Build the five floating topic capsules

**Files:**
- Modify: `frontend/src/styles/news.css`
- Modify: `frontend/src/pages/NewsPage.test.tsx`

**Interfaces:**
- Consumes: `.news-tab-shell`, `.news-tab-row`, `.news-tab`, and `.news-tab-active` from Task 1.
- Produces: desktop capsule geometry and mobile horizontal-scroll behavior.

- [ ] **Step 1: Write the failing active-state test**

Add this interaction test:

```tsx
it("moves the liquid active state between standalone topic capsules", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    jsonResponse({ items: [], limit: 20, offset: 0, has_more: false }),
  ));
  const user = userEvent.setup();
  renderPage();

  const robotics = await screen.findByRole("button", { name: "Robotics" });
  expect(screen.getByRole("button", { name: /Tất cả/i })).toHaveClass("news-tab-active");
  await user.click(robotics);
  expect(robotics).toHaveClass("news-tab-active");
});
```

- [ ] **Step 2: Verify the active-state test fails only if the current tab class is broken**

Run: `npx.cmd vitest run src/pages/NewsPage.test.tsx`

Expected: PASS before CSS work; this protects the existing filter state while the appearance changes.

- [ ] **Step 3: Apply the capsule material and geometry**

Desktop requirements:

```css
.news-tab-row { gap: 14px; }
.news-tab {
  min-width: 172px;
  min-height: 52px;
  border-radius: 999px;
  border: 1px solid var(--news-bar-edge);
  background: var(--news-bar-fill);
  box-shadow: inset 0 1px 0 var(--news-bar-rim), 0 10px 18px rgba(102, 126, 181, 0.16);
}
.news-tab-active {
  color: #fff;
  border-color: rgba(55, 158, 244, 0.78);
  background: linear-gradient(108deg, #1bd5e4 0%, #29bdef 52%, #4a82ee 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.62), 0 12px 21px rgba(31, 154, 236, 0.38);
}
```

Add a `.news-tab::before` inner rim using `position: absolute`, `inset: 2px`, a transparent border, and `pointer-events: none`. Give the button `position: relative; overflow: hidden; isolation: isolate`, then place its label above the pseudo-layer with `z-index: 1` using a child `<span className="news-tab-label">{t.label}</span>`.

At 700px and below, retain the 52px height, set `.news-tab-row { flex-wrap: nowrap; overflow-x: auto; }`, and set `.news-tab { min-width: max-content; padding-inline: 22px; }`.

- [ ] **Step 4: Verify functional and production checks**

Run: `npx.cmd vitest run src/pages/NewsPage.test.tsx; npx.cmd tsc --noEmit; npx.cmd vite build`

Expected: News tests pass, TypeScript exits 0, and Vite build exits 0.

- [ ] **Step 5: Commit the topic capsules**

```powershell
git add frontend/src/styles/news.css frontend/src/pages/NewsPage.tsx frontend/src/pages/NewsPage.test.tsx
git commit -m "feat(news): build floating liquid topic capsules"
```

### Task 4: Visual acceptance pass

**Files:**
- Verify only: `frontend/src/pages/NewsPage.tsx`
- Verify only: `frontend/src/styles/news.css`

**Interfaces:**
- Consumes: complete Tasks 1–3 implementation.
- Produces: a screenshot comparison at desktop and mobile widths.

- [ ] **Step 1: Start the project’s configured frontend preview**

Run the frontend command from `.Codex/launch.json` if present; otherwise run `npx.cmd vite --host 127.0.0.1 --port 4173` from `frontend/`.

- [ ] **Step 2: Capture the desktop comparison**

At a 1,200px-wide viewport, verify the command bar has one uninterrupted horizontal silhouette, 28px outer corners, a visible inner rim, and controls that look raised. Verify the five pills have 14px gaps, align on one baseline, and the cyan active pill is the only saturated object.

- [ ] **Step 3: Capture the mobile comparison**

At a 390px-wide viewport, verify the header has no overlap and the tab row scrolls horizontally; no labels wrap or shrink below the readable 52px capsule height.

- [ ] **Step 4: Verify theme independence and motion**

Switch the parent app between its dark and light themes. In both cases, verify News remains white. Hover the back, refresh, and inactive tab controls: only transform/shadow changes occur. Under reduced motion, their translation is removed by the existing global motion rule.

- [ ] **Step 5: Commit only a correction that was required by the visual check**

```powershell
git add frontend/src/pages/NewsPage.tsx frontend/src/pages/NewsPage.test.tsx frontend/src/styles/news.css
git commit -m "fix(news): tune liquid bar geometry"
```

If no correction is required, do not create an empty commit.

## Self-review

**Spec coverage:** Task 1 creates stable boundaries; Task 2 builds the large command bar; Task 3 builds the separate topic capsules and preserves filtering; Task 4 verifies geometry, responsive behavior, theme independence, and motion. Article cards, asset generation, data fetching, and global style changes are excluded deliberately.

**Completeness scan:** Each task states paths, interfaces, an exact test or visual assertion, a command, expected result, and commit boundary.

**Type consistency:** `news-command-shell`, `news-command-bar`, `news-tab-shell`, `news-tab-row`, and `news-tab-label` are named once and used consistently by their follow-up CSS tasks.
