# White Liquid Glass News Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/news` as an accessible, responsive pearl-white liquid-glass digest that stays visually white regardless of the application theme.

**Architecture:** `NewsPage` keeps its current `useNews` data and control behavior, but gains small presentational helpers for a decorative canvas and topic thumbnail lookup. `news.css` owns a route-local white palette, the composited glass geometry, and responsive behavior; it must not change global theme tokens or import ordering. Four bundled decorative thumbnail assets provide stable card orientation without external image fetching.

**Tech Stack:** React 18, TypeScript, Vitest + Testing Library, Vite, hand-written CSS, built-in ImageGen for local PNG assets.

## Global Constraints

- Visual direction and acceptance reference: `docs/superpowers/specs/2026-07-28-news-white-liquid-design.md`.
- `/news` must render on a local white palette in either application theme; no global token or `data-theme` changes.
- Keep the existing API contract, `useNews` hook, topic filters, refresh/cooldown behavior, external links, fallback title/summary, and internal page scrolling.
- Use `frontend/src/styles/news.css` only for News visual rules; do not reorder `frontend/src/styles.css`.
- Use no external image URLs. Generate local, non-branded PNG assets with no embedded text or logos.
- Decorative layers and topic thumbnails are `aria-hidden`; the article title remains the external-link target.
- All hover/focus motion uses explicit compositor-safe `transform`/`opacity` transitions with existing duration/easing tokens; no `transition: all` or continuous decorative animation.
- Run commands from `frontend/` with `npx.cmd` on PowerShell.

---

### Task 1: Lock in the News route’s visual structure and accessibility contract

**Files:**
- Modify: `frontend/src/pages/NewsPage.test.tsx`
- Modify: `frontend/src/pages/NewsPage.tsx`

**Interfaces:**
- Consumes: `NewsItem` and `NewsTopic` from `frontend/src/hooks/useNews.ts`.
- Produces: `NEWS_TOPIC_VISUALS: Record<NewsTopic, string>` and `NewsCard` markup with `.news-card-visual`, `.news-card-content`, and `.news-card-link-cue` hooks for Task 3.

- [ ] **Step 1: Write failing component tests for local-art structure**

Add these tests after the existing liquid-ambient test. They assert stable semantics rather than computed CSS styles:

```tsx
it("keeps the white-liquid canvas and decorations out of the accessibility tree", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    jsonResponse({ items: [SAMPLE_ITEM], limit: 20, offset: 0, has_more: false }),
  ));
  const { container } = renderPage();

  await screen.findByRole("link");
  expect(container.querySelector(".news-white-liquid-canvas")).toHaveAttribute("aria-hidden", "true");
  expect(container.querySelectorAll(".news-liquid-object")).toHaveLength(3);
});

it("renders a decorative topic thumbnail and link cue for every article", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    jsonResponse({ items: [SAMPLE_ITEM], limit: 20, offset: 0, has_more: false }),
  ));
  const { container } = renderPage();

  await screen.findByRole("link");
  const visual = container.querySelector(".news-card-visual");
  expect(visual).toHaveAttribute("aria-hidden", "true");
  expect(visual?.querySelector("img")).toHaveAttribute("src", expect.stringContaining("model-release.png"));
  expect(container.querySelector(".news-card-link-cue")).toHaveAttribute("aria-hidden", "true");
});
```

- [ ] **Step 2: Run the targeted test to verify it fails for the missing white-canvas and card structure**

Run: `npx.cmd vitest run src/pages/NewsPage.test.tsx`

Expected: FAIL because `.news-white-liquid-canvas`, `.news-liquid-object`, `.news-card-visual`, and `.news-card-link-cue` do not yet exist.

- [ ] **Step 3: Add minimal semantic markup and topic visual lookup**

At the top of `NewsPage.tsx`, import the local files and expose this exact lookup:

```tsx
import communityVisual from "../assets/news/community.png";
import modelReleaseVisual from "../assets/news/model-release.png";
import researchVisual from "../assets/news/research.png";
import roboticsVisual from "../assets/news/robotics.png";

const NEWS_TOPIC_VISUALS: Record<NewsTopic, string> = {
  model_release: modelReleaseVisual,
  research: researchVisual,
  robotics: roboticsVisual,
  community: communityVisual,
};
```

Replace the current ambient element with this non-interactive composition:

```tsx
<div className="news-white-liquid-canvas" aria-hidden="true">
  <span className="news-liquid-object news-liquid-ribbon" />
  <span className="news-liquid-object news-liquid-lens" />
  <span className="news-liquid-object news-liquid-loop" />
</div>
```

Inside each `.news-card`, place this before the existing title link and wrap the title/summary/meta in `.news-card-content`:

```tsx
<div className="news-card-visual" aria-hidden="true">
  <img src={NEWS_TOPIC_VISUALS[item.topic]} alt="" />
</div>
<div className="news-card-content">
  <a href={item.url} target="_blank" rel="noopener noreferrer" className="news-card-title">
    {item.title_vi || item.title}
  </a>
  <p className="news-card-summary">{item.summary_vi || item.title}</p>
  <div className="news-card-meta">...</div>
</div>
<span className="news-card-link-cue" aria-hidden="true">→</span>
```

Keep the existing metadata spans exactly as they are inside the ellipsis above; only add the wrapper. Do not add click handlers to the card or cue.

- [ ] **Step 4: Run the targeted tests to verify the structure passes**

Run: `npx.cmd vitest run src/pages/NewsPage.test.tsx`

Expected: PASS with the existing fetch, filter, refresh, cooldown, fallback, scroll-region, and new visual-structure tests.

- [ ] **Step 5: Commit the semantic structure**

```powershell
git add frontend/src/pages/NewsPage.tsx frontend/src/pages/NewsPage.test.tsx
git commit -m "feat(news): add white liquid article structure"
```

### Task 2: Create bounded, local topic visuals

**Files:**
- Create: `frontend/src/assets/news/model-release.png`
- Create: `frontend/src/assets/news/research.png`
- Create: `frontend/src/assets/news/robotics.png`
- Create: `frontend/src/assets/news/community.png`

**Interfaces:**
- Consumes: filenames defined in `NEWS_TOPIC_VISUALS` in Task 1.
- Produces: four PNG modules Vite can import as `string` URLs.

- [ ] **Step 1: Generate the model-release visual**

Use built-in ImageGen with this prompt, then inspect the output before copying it to `frontend/src/assets/news/model-release.png`:

```text
Use case: ui-mockup. Asset type: 4:3 decorative thumbnail in an AI news card.
Primary request: a luminous abstract glass neural orb floating above a clear circular pedestal.
Style: white liquid-glass product render, pale blue and soft lavender reflections, very bright pearl-white studio background.
Constraints: no people, no words, no logos, no watermark, no dark background, subject centered with generous clean margins.
```

- [ ] **Step 2: Generate the research visual**

Use built-in ImageGen with this prompt, then inspect the output before copying it to `frontend/src/assets/news/research.png`:

```text
Use case: ui-mockup. Asset type: 4:3 decorative thumbnail in an AI news card.
Primary request: a translucent lavender glass cube with small suspended bubbles and soft blue refracted light.
Style: white liquid-glass product render, very bright pearl-white studio background.
Constraints: no people, no words, no logos, no watermark, no dark background, subject centered with generous clean margins.
```

- [ ] **Step 3: Generate the robotics visual**

Use built-in ImageGen with this prompt, then inspect the output before copying it to `frontend/src/assets/news/robotics.png`:

```text
Use case: ui-mockup. Asset type: 4:3 decorative thumbnail in an AI news card.
Primary request: a small white industrial robotic arm on a pale blue glass plinth.
Style: refined white liquid-glass product render, soft blue reflections, very bright pearl-white studio background.
Constraints: no people, no words, no logos, no watermark, no dark background, subject centered with generous clean margins.
```

- [ ] **Step 4: Generate the community visual**

Use built-in ImageGen with this prompt, then inspect the output before copying it to `frontend/src/assets/news/community.png`:

```text
Use case: ui-mockup. Asset type: 4:3 decorative thumbnail in an AI news card.
Primary request: four diverse professional silhouettes seated around a glowing translucent AI sphere in a white glass meeting space.
Style: refined white liquid-glass editorial render, pale blue reflections, very bright pearl-white studio background.
Constraints: no words, no logos, no watermark, no dark background, faces not prominent, subject centered with generous clean margins.
```

- [ ] **Step 5: Validate all files exist and are importable**

Run: `Get-Item src/assets/news/model-release.png, src/assets/news/research.png, src/assets/news/robotics.png, src/assets/news/community.png | Select-Object Name,Length`

Expected: four non-empty PNG files.

- [ ] **Step 6: Commit the topic visuals**

```powershell
git add frontend/src/assets/news
git commit -m "feat(news): add liquid glass topic visuals"
```

### Task 3: Replace the current glass styling with the white-liquid composition

**Files:**
- Modify: `frontend/src/styles/news.css`
- Modify: `frontend/src/pages/NewsPage.test.tsx`

**Interfaces:**
- Consumes: `.news-white-liquid-canvas`, `.news-liquid-object`, `.news-card-visual`, `.news-card-content`, and `.news-card-link-cue` from Task 1.
- Produces: route-local `--news-*` visual tokens and responsive CSS for the News composition.

- [ ] **Step 1: Write the failing style-contract test**

Add this test to the existing test file, importing the stylesheet text with Vite’s raw suffix:

```tsx
import newsStyles from "../styles/news.css?raw";

it("defines a local white liquid palette without changing the global theme", () => {
  expect(newsStyles).toContain("--news-canvas:");
  expect(newsStyles).toContain(".news-card-visual img");
  expect(newsStyles).toContain("@media (max-width: 700px)");
});
```

The eventual `.news-page` selector must define and consume its own `--news-*` variables rather than any global foreground/background token; this demonstrates that the local route palette does not inherit application theme colors.

- [ ] **Step 2: Run the targeted test to verify it fails because the local palette contract is absent**

Run: `npx.cmd vitest run src/pages/NewsPage.test.tsx`

Expected: FAIL because `--news-canvas:`, `.news-card-visual img`, and the new mobile breakpoint are absent from the current stylesheet.

- [ ] **Step 3: Rebuild `news.css` with local palette, liquid objects, and glass surfaces**

Replace the current ambient-gradient approach. Start `news.css` with this token contract and preserve page scrolling:

```css
.news-page {
  --news-canvas: #f7f9ff;
  --news-ink: #101a43;
  --news-muted: #63708a;
  --news-rim: rgba(255, 255, 255, 0.92);
  --news-edge: rgba(126, 144, 184, 0.27);
  --news-glass: rgba(255, 255, 255, 0.58);
  --news-shadow: 0 18px 42px rgba(105, 127, 177, 0.17);
  box-sizing: border-box;
  isolation: isolate;
  position: relative;
  height: 100vh;
  height: 100dvh;
  overflow-x: hidden;
  overflow-y: auto;
  color: var(--news-ink);
  background: radial-gradient(circle at 74% 8%, #e9f3ff 0, transparent 30%), var(--news-canvas);
}
```

Implement the decorative classes with absolute positioning, `pointer-events: none`, multiple static gradients for rim/highlight/refraction, and `z-index: 0`. Put every real page section at `z-index: 1`. Build command bar, tabs, and cards from white/transparent layers with `backdrop-filter`, a bright inset rim, and restrained cool shadows. Use `color: var(--news-ink)` on buttons, title, and links rather than global text tokens.

For cards, use desktop grid geometry:

```css
.news-card {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr) 54px;
  align-items: center;
  gap: 28px;
}

.news-card-visual {
  overflow: hidden;
  aspect-ratio: 4 / 3;
  border: 1px solid var(--news-rim);
  border-radius: 22px;
  box-shadow: inset 0 0 0 1px var(--news-edge), 0 10px 26px rgba(105, 127, 177, 0.14);
}

.news-card-visual img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
```

At `@media (max-width: 700px)`, set `.news-card { grid-template-columns: 1fr; gap: 14px; }`, hide `.news-liquid-lens` and `.news-liquid-loop`, and give `.news-card-visual` a maximum width of `100%`. Use an explicit `:focus-visible` outline for the back button, refresh button, tabs, and article title.

- [ ] **Step 4: Run component tests and static checks to verify the new composition**

Run: `npx.cmd vitest run src/pages/NewsPage.test.tsx; npx.cmd tsc --noEmit; npx.cmd vite build`

Expected: all NewsPage tests pass, TypeScript exits 0, and Vite emits a production build with all four image assets resolved.

- [ ] **Step 5: Manually verify the rendered route at three widths and both app themes**

Run: `npx.cmd vite --host 127.0.0.1`

Open `/news` at 1440px, 900px, and 390px widths. In both application `data-theme="dark"` and `data-theme="light"`, verify:

```text
desktop: white canvas, left ribbon, right lens, glass command bar, pill tabs, horizontal cards
tablet: no content/decorative overlap and no horizontal body overflow
mobile: white canvas, compact command bar, scrollable tabs, vertical article cards
both themes: same white News route, readable dark text, visible focus ring, working page scroll
```

Use browser rendering controls to emulate `prefers-reduced-motion: reduce`; hover states must not translate.

- [ ] **Step 6: Commit the visual implementation**

```powershell
git add frontend/src/styles/news.css frontend/src/pages/NewsPage.test.tsx
git commit -m "feat(news): build white liquid glass digest"
```

### Task 4: Perform final regression verification

**Files:**
- Verify only: `frontend/src/pages/NewsPage.tsx`
- Verify only: `frontend/src/pages/NewsPage.test.tsx`
- Verify only: `frontend/src/styles/news.css`
- Verify only: `frontend/src/assets/news/*.png`

**Interfaces:**
- Consumes: complete Tasks 1–3 implementation.
- Produces: evidence that the route’s existing behavior remains intact.

- [ ] **Step 1: Run the full frontend test suite**

Run: `npx.cmd vitest run`

Expected: all frontend tests pass with no new test warning.

- [ ] **Step 2: Run type and build verification**

Run: `npx.cmd tsc --noEmit; npx.cmd vite build`

Expected: both commands exit 0.

- [ ] **Step 3: Review the final diff against the approved scope**

Run: `git diff develop~3..HEAD -- frontend/src/pages/NewsPage.tsx frontend/src/pages/NewsPage.test.tsx frontend/src/styles/news.css frontend/src/assets/news`

Expected: only News presentation, tests, and local asset changes; no changes to backend ingestion, `useNews`, global themes, landing page, or sidebar.

- [ ] **Step 4: Commit any verification-only corrections, if and only if a correction was needed**

```powershell
git add frontend/src/pages/NewsPage.tsx frontend/src/pages/NewsPage.test.tsx frontend/src/styles/news.css frontend/src/assets/news
git commit -m "fix(news): polish white liquid digest"
```

If no correction is needed, do not create an empty commit.

## Self-review

**Spec coverage:** Task 1 preserves behavior and accessibility semantics. Task 2 supplies deterministic local orientation art. Task 3 implements the white independent palette, exact compositional primitives, responsive treatment, focus/motion rules, and build checks. Task 4 covers full regression, type/build verification, and scope review.

**Completeness scan:** Every task names the exact structural and visual change, with the test, command, expected result, and commit boundary included.

**Type consistency:** `NEWS_TOPIC_VISUALS` is a `Record<NewsTopic, string>` used by `NewsCard` markup. Asset filenames in Task 2 exactly match the Task 1 imports. CSS hooks asserted in Task 1 are the same hooks styled in Task 3.
