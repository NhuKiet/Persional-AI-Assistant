# News Liquid Glass Bars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish and verify a responsive, theme-independent hybrid CSS/SVG recreation of the two liquid-glass control bars in the supplied News page reference.

**Architecture:** Keep the existing `NewsPage` data flow and semantic controls. HTML/SVG provides stable stroked icons and hidden decorative filter definitions; `news.css` owns all geometry and the complete no-filter fallback, while refraction is restricted to highlight pseudo-elements. Component tests protect semantics and loading behavior, a focused CSS contract protects material/responsive invariants, and real-browser screenshots drive the final visual calibration.

**Tech Stack:** React 18, TypeScript, hand-written CSS, inline SVG filters, Vitest, Testing Library, Vite, in-app Browser/Chrome.

## Global Constraints

- Scope is limited to the News command bar and five topic capsules; do not restyle article cards or change news fetching/filter/refresh behavior.
- The News surface remains bright white liquid glass in both application themes.
- CSS owns layout and geometry; SVG refraction applies only to decorative highlights and never to text, icons, focus rings, or hit targets.
- The CSS-only result is a complete fallback when SVG filters or `backdrop-filter` are unavailable.
- Desktop calibration target is the supplied 1309 × 202 px reference image.
- At the reference width, target a 76 px command body with a 28 px radius, a 52 px interactive Back control, a 52 px Refresh control, and approximately 14–18 px topic gaps.
- Topic widths follow their labels; the active topic uses a cyan → sky blue → royal blue gradient with white text.
- Mobile keeps controls at least 44 × 44 CSS px and presents topics as one horizontally scrollable row.
- Reduced-motion mode removes positional motion, refresh rotation, and refraction without degrading the static design.
- Do not reorder `frontend/src/styles.css`; all styling remains in `frontend/src/styles/news.css`.
- Before editing CSS, read `.agents/skills/css-architecture/SKILL.md`. Before editing transitions or `@keyframes`, also read `.agents/skills/ui-motion/SKILL.md`.
- Preserve all pre-existing working-tree changes. At plan-writing time, `NewsPage.tsx`, `NewsPage.test.tsx`, and `news.css` already contain uncommitted hybrid-glass WIP; review and build on it, never reset or overwrite it.
- Stage and commit only the files named by the current task.

## File Structure

- Modify `frontend/src/pages/NewsPage.tsx`
  - owns semantic bar markup, stable stroked icons, loading announcement, and decorative SVG filter definitions.
- Modify `frontend/src/pages/NewsPage.test.tsx`
  - owns behavior and accessibility contracts for the command bar and topic controls.
- Modify `frontend/src/styles/news.css`
  - owns News-local glass tokens, desktop geometry, interaction states, compatibility fallbacks, and responsive behavior.
- Create `frontend/src/test/news-liquid-bars.contract.test.ts`
  - owns source-level CSS contracts that prevent accidental loss of the approved glass layers and responsive safeguards.
- Reference only `docs/superpowers/specs/2026-07-28-news-liquid-bars-design.md`
  - source of truth for scope and acceptance criteria.

---

### Task 1: Lock the semantic and SVG structure

**Files:**

- Modify: `frontend/src/pages/NewsPage.test.tsx:110-160`
- Modify: `frontend/src/pages/NewsPage.tsx:40-183`

**Interfaces:**

- Consumes: existing `refreshState: "idle" | "loading" | "cooldown"` and `setTopic(NewsTopic | null)` behavior from `useNews`.
- Produces: `.news-liquid-defs`, `#news-liquid-refraction`, `#news-liquid-refraction-soft`, `.news-back-icon`, `.news-refresh-icon`, `.news-refresh-label`, and `.news-sr-only` hooks consumed by Task 2 and Task 3.

- [ ] **Step 1: Inspect and preserve the existing WIP**

Run:

```powershell
git diff -- frontend/src/pages/NewsPage.tsx frontend/src/pages/NewsPage.test.tsx frontend/src/styles/news.css
```

Expected: the diff may already contain the SVG filters, stroked icons, fixed
Refresh label, and CSS work described below. Keep those edits. Do not run
`git checkout`, `git restore`, or `git reset`.

- [ ] **Step 2: Add the component contracts**

Ensure `frontend/src/pages/NewsPage.test.tsx` contains these tests inside the
existing `describe("NewsPage", ...)` block:

```tsx
it("draws the bar controls with stroked icons instead of text glyphs", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    jsonResponse({ items: [SAMPLE_ITEM], limit: 20, offset: 0, has_more: false }),
  ));
  const { container } = renderPage();

  const back = await screen.findByRole("button", { name: "Về trang chủ" });
  const backIcon = back.querySelector(".news-back-icon");
  expect(backIcon).not.toBeNull();
  expect(back.textContent).toBe("");
  expect(backIcon?.querySelectorAll("path")).toHaveLength(1);
  expect(backIcon?.querySelector("path")).toHaveAttribute("stroke", "currentColor");
  expect(container.querySelectorAll(".news-refresh-icon path")).toHaveLength(2);
});

it("hides the decorative refraction filters from assistive technology", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    jsonResponse({ items: [SAMPLE_ITEM], limit: 20, offset: 0, has_more: false }),
  ));
  const { container } = renderPage();

  await screen.findByRole("button", { name: /Làm mới/i });
  const defs = container.querySelector(".news-liquid-defs");
  expect(defs).toHaveAttribute("aria-hidden", "true");
  expect(defs).toHaveAttribute("focusable", "false");
  expect(defs?.querySelector("#news-liquid-refraction")).not.toBeNull();
  expect(defs?.querySelector("#news-liquid-refraction-soft")).not.toBeNull();
});

it("keeps the refresh label fixed while loading and announces the busy state", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({ items: [], limit: 20, offset: 0, has_more: false }))
    .mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  const { container } = renderPage();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

  const refresh = screen.getByRole("button", { name: /Làm mới/i });
  await waitFor(() => expect(refresh).toBeEnabled());
  await user.click(refresh);

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(refresh).toBeDisabled());
  expect(refresh).toHaveAttribute("aria-busy", "true");
  expect(container.querySelector(".news-refresh-label")?.textContent).toBe("Làm mới");
  expect(screen.getByRole("status")).toHaveTextContent("Đang làm mới…");
});
```

- [ ] **Step 3: Run the new tests against the current working tree**

Run:

```powershell
npm test -- src/pages/NewsPage.test.tsx
```

Working directory: `frontend`

Expected: if the WIP markup is present, all News tests PASS. If it is missing,
the three new tests FAIL on the missing selectors/attributes; this is the
required red state before Step 4.

- [ ] **Step 4: Complete the minimal semantic implementation**

At the start of `<main>`, add the hidden filter definitions:

```tsx
<svg className="news-liquid-defs" width="0" height="0" aria-hidden="true" focusable="false">
  <defs>
    <filter
      id="news-liquid-refraction"
      x="-25%"
      y="-25%"
      width="150%"
      height="150%"
      colorInterpolationFilters="sRGB"
    >
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.009 0.016"
        numOctaves="2"
        seed="9"
        result="news-noise"
      />
      <feGaussianBlur in="news-noise" stdDeviation="1.8" result="news-noise-soft" />
      <feDisplacementMap
        in="SourceGraphic"
        in2="news-noise-soft"
        scale="7"
        xChannelSelector="R"
        yChannelSelector="G"
      />
    </filter>
    <filter
      id="news-liquid-refraction-soft"
      x="-25%"
      y="-25%"
      width="150%"
      height="150%"
      colorInterpolationFilters="sRGB"
    >
      <feTurbulence
        type="fractalNoise"
        baseFrequency="0.014 0.024"
        numOctaves="2"
        seed="4"
        result="news-noise-tight"
      />
      <feGaussianBlur in="news-noise-tight" stdDeviation="1.4" result="news-noise-tight-soft" />
      <feDisplacementMap
        in="SourceGraphic"
        in2="news-noise-tight-soft"
        scale="4"
        xChannelSelector="R"
        yChannelSelector="G"
      />
    </filter>
  </defs>
</svg>
```

Replace the Back and Refresh contents with stable stroked SVG and a fixed-width
loading label:

```tsx
<button className="news-back" onClick={() => navigate("/")} aria-label="Về trang chủ">
  <svg
    className="news-back-icon"
    viewBox="0 0 24 24"
    width="22"
    height="22"
    aria-hidden="true"
    focusable="false"
  >
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M19 12H5.6M12 5.6 5.6 12l6.4 6.4"
    />
  </svg>
</button>

<button
  className="news-refresh-btn"
  onClick={refresh}
  disabled={refreshState === "loading"}
  aria-busy={refreshState === "loading"}
>
  <svg
    className="news-refresh-icon"
    viewBox="0 0 24 24"
    width="17"
    height="17"
    aria-hidden="true"
    focusable="false"
  >
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M20.4 11.4a8.4 8.4 0 1 1-2.5-5.9"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M20.6 3.4v5.2h-5.2"
    />
  </svg>
  <span className="news-refresh-label">Làm mới</span>
</button>
{refreshState === "loading" && (
  <span className="news-sr-only" role="status">Đang làm mới…</span>
)}
```

- [ ] **Step 5: Verify the semantic task**

Run:

```powershell
npm test -- src/pages/NewsPage.test.tsx
npm run typecheck
```

Working directory: `frontend`

Expected: all News tests PASS and TypeScript exits with code 0.

- [ ] **Step 6: Commit only the semantic slice**

```powershell
git add frontend/src/pages/NewsPage.tsx frontend/src/pages/NewsPage.test.tsx
git commit -m "feat(news): add accessible liquid bar optics"
```

Expected: the commit contains only the two listed files. If these files include
pre-existing user changes unrelated to the two bars, stop and separate them
before committing.

---

### Task 2: Lock the desktop liquid material and geometry

**Files:**

- Create: `frontend/src/test/news-liquid-bars.contract.test.ts`
- Modify: `frontend/src/styles/news.css:1-381`

**Interfaces:**

- Consumes: SVG IDs and class hooks produced by Task 1.
- Produces: `--news-glass-*`, `--news-refraction`, and
  `--news-refraction-soft` News-local tokens plus stable desktop geometry used
  by Task 3 and visual QA.

- [ ] **Step 1: Write the desktop CSS contract**

Create `frontend/src/test/news-liquid-bars.contract.test.ts` with:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const stylesDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../styles",
);
const css = readFileSync(path.join(stylesDirectory, "news.css"), "utf8");

const selectorBlock = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "s"));
  expect(match, `Expected ${selector} block`).not.toBeNull();
  return match?.[1] ?? "";
};

describe("News liquid bar CSS contract", () => {
  it("defines independently tunable liquid-glass layers", () => {
    const page = selectorBlock(".news-page");
    for (const token of [
      "--news-glass-edge",
      "--news-glass-rim-outer",
      "--news-glass-rim-inner",
      "--news-glass-specular",
      "--news-glass-underside",
      "--news-glass-ambient",
      "--news-glass-ambient-lift",
      "--news-refraction",
      "--news-refraction-soft",
    ]) {
      expect(page, `News page must define ${token}`).toMatch(new RegExp(`${token}\\s*:`));
    }
  });

  it("matches the approved desktop geometry", () => {
    const command = selectorBlock(".news-command-bar");
    const back = selectorBlock(".news-back");
    const refresh = selectorBlock(".news-refresh-btn");
    const tab = selectorBlock(".news-tab");

    expect(command).toMatch(/height:\s*76px;/);
    expect(command).toMatch(/border-radius:\s*28px;/);
    expect(back).toMatch(/height:\s*52px;/);
    expect(refresh).toMatch(/width:\s*146px;/);
    expect(refresh).toMatch(/height:\s*52px;/);
    expect(tab).toMatch(/flex:\s*0 0 auto;/);
    expect(tab).toMatch(/border-radius:\s*999px;/);
  });

  it("refracts only decorative pseudo-elements", () => {
    expect(css).toMatch(
      /\.news-command-bar::after\s*\{[^}]*filter:\s*var\(--news-refraction\);/s,
    );
    expect(css).toMatch(
      /\.news-back::after,[\s\S]*?\.news-tab::after\s*\{[^}]*filter:\s*var\(--news-refraction-soft\);/s,
    );
    expect(css).not.toMatch(/\.news-tab-label\s*\{[^}]*\bfilter\s*:/s);
    expect(css).not.toMatch(/\.news-refresh-label\s*\{[^}]*\bfilter\s*:/s);
  });

  it("keeps the active topic on the approved cyan-to-blue treatment", () => {
    const active = selectorBlock(".news-tab-active");
    expect(active).toMatch(
      /linear-gradient\(100deg,\s*#17c9e2 0%,\s*#1d9ae0 46%,\s*#3f74ea 100%\)/,
    );
    expect(active).toMatch(/color:\s*#fff;/);
  });
});
```

- [ ] **Step 2: Run the contract to verify its red or green baseline**

Run:

```powershell
npm test -- src/test/news-liquid-bars.contract.test.ts
```

Working directory: `frontend`

Expected: on a clean `HEAD` baseline, FAIL on the missing glass tokens. With the
existing WIP preserved, it may already PASS; in that case, treat this as a
regression-contract adoption and continue to code review in Step 3.

- [ ] **Step 3: Complete the News-local material tokens**

Inside `.news-page`, ensure these tokens exist:

```css
--news-glass-edge: rgba(143, 160, 199, 0.34);
--news-glass-rim-outer: rgba(255, 255, 255, 0.94);
--news-glass-rim-inner: rgba(255, 255, 255, 0.78);
--news-glass-specular: rgba(255, 255, 255, 0.86);
--news-glass-underside: rgba(94, 118, 172, 0.34);
--news-glass-ambient: 0 16px 30px rgba(102, 126, 181, 0.2);
--news-glass-ambient-lift: 0 20px 36px rgba(88, 118, 182, 0.26);
--news-refraction: url(#news-liquid-refraction);
--news-refraction-soft: url(#news-liquid-refraction-soft);
```

Use the tokens on the complete desktop bar geometry:

```css
.news-command-shell {
  width: 100%;
  box-sizing: border-box;
  margin-bottom: 17px;
}

.news-command-bar {
  display: flex;
  position: relative;
  align-items: center;
  gap: 16px;
  width: 100%;
  height: 76px;
  min-height: 76px;
  box-sizing: border-box;
  padding: 10px 13px;
  border: 1px solid var(--news-glass-edge);
  border-radius: 28px;
  background:
    linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.9) 0%,
      rgba(255, 255, 255, 0.4) 46%,
      rgba(237, 244, 255, 0.54) 100%
    ),
    var(--news-bar-fill);
  box-shadow:
    0 0 0 2px var(--news-glass-rim-outer),
    inset 0 1px 0 var(--news-bar-rim),
    inset 1px 0 0 rgba(255, 255, 255, 0.72),
    inset 0 -12px 20px -16px var(--news-glass-underside),
    var(--news-glass-ambient);
  backdrop-filter: blur(24px) saturate(145%);
}

.news-command-bar::before {
  position: absolute;
  inset: 2px;
  border: 1px solid var(--news-glass-rim-inner);
  border-radius: inherit;
  content: "";
  pointer-events: none;
}

.news-command-bar::after {
  position: absolute;
  top: 3px;
  right: 13%;
  left: 15%;
  height: 24px;
  border-radius: 999px;
  background: linear-gradient(
    180deg,
    var(--news-glass-specular),
    rgba(255, 255, 255, 0) 88%
  );
  content: "";
  opacity: 0.76;
  pointer-events: none;
  filter: var(--news-refraction);
}
```

Apply the shared double-rim material only to Back, Refresh, and topic buttons:

```css
.news-back,
.news-refresh-btn,
.news-tab {
  position: relative;
  border: 1px solid var(--news-glass-edge);
  color: var(--news-ink);
  font: inherit;
  cursor: pointer;
  background:
    linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.92) 0%,
      rgba(255, 255, 255, 0.26) 54%,
      rgba(255, 255, 255, 0.5) 100%
    ),
    var(--news-bar-fill);
  box-shadow:
    0 0 0 3px var(--news-glass-rim-outer),
    inset 0 1px 0 var(--news-bar-rim),
    inset 0 -9px 15px -12px var(--news-glass-underside),
    0 8px 16px rgba(95, 117, 170, 0.16);
  backdrop-filter: blur(16px) saturate(135%);
  isolation: isolate;
}

.news-back::before,
.news-refresh-btn::before,
.news-tab::before {
  position: absolute;
  z-index: 0;
  inset: 2px;
  border: 1px solid var(--news-glass-rim-inner);
  border-radius: inherit;
  content: "";
  pointer-events: none;
}

.news-back::after,
.news-refresh-btn::after,
.news-tab::after {
  position: absolute;
  z-index: 0;
  top: 3px;
  right: 10px;
  left: 10px;
  height: 14px;
  border-radius: 999px;
  background: linear-gradient(
    180deg,
    var(--news-glass-specular),
    rgba(255, 255, 255, 0) 90%
  );
  content: "";
  pointer-events: none;
  filter: var(--news-refraction-soft);
}
```

Use label-driven topic widths and the approved active state:

```css
.news-tab-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 16px;
  margin-bottom: 24px;
  padding-top: 4px;
}

.news-tab {
  display: inline-grid;
  height: 48px;
  flex: 0 0 auto;
  place-items: center;
  box-sizing: border-box;
  min-height: 48px;
  padding-inline: clamp(22px, 5vw, 60px);
  border-radius: 999px;
  font-size: 1rem;
  font-weight: 520;
}

.news-tab-active {
  border-color: rgba(48, 140, 226, 0.72);
  color: #fff;
  background: linear-gradient(100deg, #17c9e2 0%, #1d9ae0 46%, #3f74ea 100%);
  text-shadow: 0 1px 2px rgba(9, 44, 96, 0.34);
  box-shadow:
    0 0 0 3px var(--news-glass-rim-outer),
    inset 0 1px 0 rgba(255, 255, 255, 0.66),
    inset 0 -9px 15px -10px rgba(12, 56, 122, 0.5),
    0 10px 20px rgba(31, 154, 236, 0.36);
}
```

- [ ] **Step 4: Verify the desktop CSS contract**

Run:

```powershell
npm test -- src/test/news-liquid-bars.contract.test.ts
npm test -- src/pages/NewsPage.test.tsx
```

Working directory: `frontend`

Expected: both test files PASS.

- [ ] **Step 5: Commit only the desktop material slice**

```powershell
git add frontend/src/styles/news.css frontend/src/test/news-liquid-bars.contract.test.ts
git commit -m "style(news): match desktop liquid glass bars"
```

Expected: the commit contains only `news.css` and the new CSS contract.

---

### Task 3: Protect motion, fallback, and responsive behavior

**Files:**

- Modify: `frontend/src/test/news-liquid-bars.contract.test.ts`
- Modify: `frontend/src/styles/news.css:245-320,524-658`

**Interfaces:**

- Consumes: Task 2 material tokens and desktop selectors.
- Produces: hover/pressed/loading states, no-`backdrop-filter` fallback,
  reduced-motion behavior, and 1099 px/700 px responsive rules.

- [ ] **Step 1: Add the compatibility and responsive contract**

Append these tests inside the existing CSS-contract `describe`:

```ts
it("provides an opaque fallback without changing geometry", () => {
  expect(css).toMatch(/@supports not \(backdrop-filter:\s*blur\(2px\)\)/);
  expect(css).toMatch(
    /@supports not[\s\S]*\.news-command-bar,[\s\S]*background-color:\s*rgba\(255,\s*255,\s*255,\s*0\.94\);/,
  );
});

it("removes motion and refraction for reduced-motion users", () => {
  expect(css).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)/);
  expect(css).toMatch(
    /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*--news-refraction:\s*none;/,
  );
  expect(css).toMatch(
    /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*animation:\s*none;/,
  );
});

it("keeps mobile targets accessible and topics horizontally scrollable", () => {
  expect(css).toMatch(/@media \(max-width:\s*700px\)/);
  expect(css).toMatch(
    /@media \(max-width:\s*700px\)[\s\S]*\.news-tab-row\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto;/,
  );
  expect(css).toMatch(
    /@media \(max-width:\s*700px\)[\s\S]*\.news-back\s*\{[^}]*width:\s*46px;[^}]*height:\s*46px;/,
  );
  expect(css).toMatch(
    /@media \(max-width:\s*700px\)[\s\S]*\.news-refresh-btn\s*\{[^}]*min-width:\s*46px;[^}]*min-height:\s*46px;/,
  );
});
```

- [ ] **Step 2: Run the new contract to verify its baseline**

Run:

```powershell
npm test -- src/test/news-liquid-bars.contract.test.ts
```

Working directory: `frontend`

Expected: on a clean baseline, FAIL on missing fallback/responsive guarantees.
With preserved WIP, it may PASS and should then be reviewed against Step 3.

- [ ] **Step 3: Complete interaction and loading motion**

Use the project motion tokens for hover/pressed transitions and keep movement
to one pixel:

```css
.news-back,
.news-refresh-btn,
.news-tab {
  transition:
    transform var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}

.news-back:hover,
.news-refresh-btn:hover:not(:disabled),
.news-tab:hover:not(.news-tab-active) {
  border-color: rgba(53, 141, 240, 0.4);
  box-shadow:
    0 0 0 3px #fff,
    inset 0 1px 0 var(--news-bar-rim),
    inset 0 -9px 15px -12px var(--news-glass-underside),
    var(--news-glass-ambient-lift);
  transform: translateY(-1px);
}

.news-back:active,
.news-refresh-btn:active:not(:disabled),
.news-tab:active {
  box-shadow:
    0 0 0 3px var(--news-glass-rim-outer),
    inset 0 1px 0 var(--news-bar-rim),
    inset 0 -9px 15px -12px var(--news-glass-underside),
    0 3px 8px rgba(95, 117, 170, 0.14);
  transform: translateY(1px);
}

.news-refresh-btn[aria-busy="true"] .news-refresh-icon {
  animation: news-refresh-spin 900ms linear infinite;
}

@keyframes news-refresh-spin {
  to {
    transform: rotate(360deg);
  }
}
```

- [ ] **Step 4: Complete fallback and reduced-motion rules**

```css
@supports not (backdrop-filter: blur(2px)) {
  .news-command-bar,
  .news-back,
  .news-refresh-btn,
  .news-tab {
    background-color: rgba(255, 255, 255, 0.94);
  }

  .news-tab-active {
    background-color: transparent;
  }
}

@media (prefers-reduced-motion: reduce) {
  .news-page {
    --news-refraction: none;
    --news-refraction-soft: none;
  }

  .news-back,
  .news-refresh-btn,
  .news-tab {
    transition: none;
  }

  .news-back:hover,
  .news-refresh-btn:hover:not(:disabled),
  .news-tab:hover:not(.news-tab-active),
  .news-back:active,
  .news-refresh-btn:active:not(:disabled),
  .news-tab:active {
    transform: none;
  }

  .news-refresh-btn[aria-busy="true"] .news-refresh-icon {
    animation: none;
    opacity: 0.6;
  }
}
```

- [ ] **Step 5: Complete tablet and mobile rules**

```css
@media (max-width: 1099px) {
  .news-tab-row {
    gap: 10px;
  }

  .news-tab {
    padding-inline: clamp(20px, 3vw, 40px);
  }
}

@media (max-width: 700px) {
  .news-page {
    --news-refraction: none;
    --news-refraction-soft: none;
  }

  .news-command-bar {
    gap: 8px;
    height: 64px;
    min-height: 64px;
    padding: 6px;
    border-radius: 23px;
  }

  .news-back {
    width: 46px;
    height: 46px;
    border-radius: 16px;
  }

  .news-refresh-btn {
    width: auto;
    height: 46px;
    min-width: 46px;
    min-height: 46px;
    padding: 0 12px;
    border-radius: 16px;
    font-size: 0.86rem;
  }

  .news-tab-shell {
    margin-right: -16px;
    margin-left: -16px;
  }

  .news-tab-row {
    flex-wrap: nowrap;
    justify-content: flex-start;
    overflow-x: auto;
    padding: 9px 16px 12px;
    scrollbar-width: none;
  }

  .news-tab {
    height: 48px;
    min-width: max-content;
    min-height: 48px;
    padding-inline: 22px;
    font-size: 0.91rem;
  }
}
```

- [ ] **Step 6: Verify and commit the compatibility slice**

Run:

```powershell
npm test -- src/test/news-liquid-bars.contract.test.ts
npm test -- src/pages/NewsPage.test.tsx
npm run typecheck
```

Working directory: `frontend`

Expected: all commands exit 0.

Commit:

```powershell
git add frontend/src/styles/news.css frontend/src/test/news-liquid-bars.contract.test.ts
git commit -m "style(news): harden liquid bars across viewports"
```

---

### Task 4: Calibrate against the reference in a real browser

**Files:**

- Modify only if visual evidence requires it: `frontend/src/styles/news.css`
- Test only if a behavior changes: `frontend/src/pages/NewsPage.test.tsx`
- Test only if a CSS invariant changes: `frontend/src/test/news-liquid-bars.contract.test.ts`

**Interfaces:**

- Consumes: completed bars from Tasks 1–3 and the supplied 1309 × 202 reference.
- Produces: visually calibrated desktop/tablet/mobile bars with recorded
  screenshot evidence and no runtime warnings.

- [ ] **Step 1: Start the Vite frontend**

Run:

```powershell
npm run dev -- --host 127.0.0.1
```

Working directory: `frontend`

Expected: Vite prints a local URL, normally `http://127.0.0.1:5173/`. Keep this
process running in the background.

- [ ] **Step 2: Open the News route and capture the desktop calibration view**

Use the `browser:control-in-app-browser` skill and open:

```text
http://127.0.0.1:5173/news
```

Set the viewport to 1309 × 800 and capture the top 202 px. Compare side by side
with the supplied reference and record pass/fail for:

```text
outer inset ≈ 17 px
command body = 76 px
command radius = 28 px
Back interactive body = 58 × 52 px
Refresh interactive body = 146 × 52 px
topic gap = 14–18 px
topic widths follow label length
active gradient runs cyan → sky blue → royal blue
double white rim is visible
cool lower shadow is visible without a gray cast
title and icons are vertically centered
```

Expected: the control silhouettes and spacing visually align with the
reference. Article cards may differ and are ignored.

- [ ] **Step 3: Tune only evidence-backed CSS values**

If a mismatch is visible, change only the corresponding News-local declaration.
Use this mapping:

```text
horizontal alignment  → .news-page padding / .news-command-shell
command silhouette    → .news-command-bar height, padding, border-radius
Back silhouette       → .news-back width, height, border-radius
Refresh silhouette    → .news-refresh-btn width, height, border-radius
topic rhythm          → .news-tab-row gap / .news-tab padding-inline
rim thickness         → outer box-shadow spread / ::before inset and border
specular placement    → ::after top, left, right, height, opacity
glass depth           → --news-glass-underside / --news-glass-ambient
active color          → .news-tab-active linear-gradient stops
liquid intensity      → SVG feDisplacementMap scale, maximum 7 for command and 4 for controls
```

Do not modify `.news-card`, `.news-list`, API hooks, or global theme tokens.

- [ ] **Step 4: Verify tablet, mobile, keyboard, themes, and reduced motion**

In the browser, inspect:

```text
1099 × 800 — capsules close gaps without clipping
700 × 800  — mobile breakpoint remains coherent
390 × 844  — topic row scrolls horizontally; Back and Refresh stay ≥44 px
```

At each size:

1. Tab through Back, Refresh, and all five topics; focus rings remain visible.
2. Activate `Robotics`; only the selected capsule receives the blue gradient.
3. Toggle application light/dark theme; News bars stay bright white.
4. Emulate `prefers-reduced-motion: reduce`; controls do not translate, Refresh
   does not rotate, and decorative refraction is disabled.
5. Inspect the console; no React, SVG filter, or CSS warnings are present.

Expected: all five checks pass at all three viewports.

- [ ] **Step 5: Run full frontend verification**

Stop only if one of these commands fails:

```powershell
npm test
npm run typecheck
npm run build
```

Working directory: `frontend`

Expected:

```text
Vitest: all test files pass
TypeScript: exit code 0
Vite build: exit code 0 and frontend/dist generated
```

- [ ] **Step 6: Review the final diff and commit calibration**

Run:

```powershell
git diff --check
git diff -- frontend/src/pages/NewsPage.tsx frontend/src/pages/NewsPage.test.tsx frontend/src/styles/news.css frontend/src/test/news-liquid-bars.contract.test.ts
git status --short
```

Expected: no whitespace errors; only the intended News files are included in
this feature. Existing Landing/backend changes remain unstaged.

If Task 4 changed files, commit them:

```powershell
git add frontend/src/pages/NewsPage.tsx frontend/src/pages/NewsPage.test.tsx frontend/src/styles/news.css frontend/src/test/news-liquid-bars.contract.test.ts
git commit -m "fix(news): calibrate liquid bars to reference"
```

If visual verification required no further code changes, do not create an empty
commit.

---

## Final Acceptance Checklist

- [ ] Only the command bar and topic capsules are materially restyled.
- [ ] Desktop geometry is calibrated at 1309 px against the supplied reference.
- [ ] White glass remains identical under both application themes.
- [ ] Double rims, upper specular highlights, cool underside shading, and soft
      shadows are visible without making the controls opaque gray.
- [ ] Refraction touches decorative highlights only.
- [ ] Active topic is cyan-to-blue with white text.
- [ ] Topic widths follow label length.
- [ ] Mobile uses one horizontally scrollable topic row.
- [ ] All targets are at least 44 × 44 CSS px on mobile.
- [ ] Keyboard focus is visible and unclipped.
- [ ] Reduced-motion and unsupported-filter fallbacks remain usable and visually
      coherent.
- [ ] Existing filter and Refresh behavior still pass their component tests.
- [ ] `npm test`, `npm run typecheck`, and `npm run build` all exit 0.
