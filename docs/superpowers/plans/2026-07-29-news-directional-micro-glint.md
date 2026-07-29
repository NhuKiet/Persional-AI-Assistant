# News Directional Micro-Glint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the centered pill-shaped glass highlight with a small upper-left glint that falls diagonally toward the lower-right.

**Architecture:** Keep the existing React settings API and decorative `shine` layer. Narrow the Splay output in the pure settings mapper, then reposition and reshape the existing `::before` dispersion and `::after` highlight pseudo-elements. No new component, layer, animation, or dependency is needed.

**Tech Stack:** TypeScript, hand-written CSS, SVG filters, Vitest.

## Global Constraints

- Anchor the primary highlight at the upper-left corner; never center it.
- Keep Splay bounded from exactly 8% at value 0 to exactly 26% at value 100.
- Keep Light Angle, Light Intensity, Splay, and Dispersion functional.
- Confine cyan/magenta dispersion to the same upper-left corner.
- Never form a centered pill, horizontal bar, continuous white edge, or full white perimeter.
- Keep real news loading, the settings popover, Falling Leaves, topic controls, feed layout, responsive behavior, and reduced-motion behavior unchanged.
- Add no component, animation, dependency, or stylesheet.
- `frontend/src/styles/news.css` and `frontend/src/test/news-liquid-bars.contract.test.ts` contain pre-existing uncommitted user changes. Never stage or commit those files wholesale.

---

### Task 1: Bound the Splay Mapping

**Files:**
- Modify: `frontend/src/components/news/newsGlassSettings.ts`
- Modify: `frontend/src/components/news/newsGlassSettings.test.ts`

**Interfaces:**
- Consumes: existing `GlassSettings.splay` range `0..100`.
- Produces: `toGlassVisualValues(settings).splay` in the exact range `"8.00%".. "26.00%"`.

- [ ] **Step 1: Write the failing mapping tests**

Change the tuned expectation and add explicit endpoints:

```ts
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
  expect(
    toGlassVisualValues({ ...GLASS_PRESETS.tuned, splay: 0 }).splay,
  ).toBe("8.00%");
  expect(
    toGlassVisualValues({ ...GLASS_PRESETS.tuned, splay: 100 }).splay,
  ).toBe("26.00%");
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
cd frontend
npm.cmd test -- --run src/components/news/newsGlassSettings.test.ts
```

Expected: FAIL because tuned currently returns `42.48%`, Splay 0 returns
`18.00%`, and Splay 100 returns `90.00%`.

- [ ] **Step 3: Implement the bounded mapping**

In `toGlassVisualValues()` replace only the Splay formula:

```ts
splay: `${(8 + settings.splay * 0.18).toFixed(2)}%`,
```

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```powershell
npm.cmd test -- --run src/components/news/newsGlassSettings.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit the clean settings files**

```powershell
git add frontend/src/components/news/newsGlassSettings.ts frontend/src/components/news/newsGlassSettings.test.ts
git commit -m "style(news): bound micro glint splay"
```

---

### Task 2: Anchor and Reshape the Glint

**Files:**
- Modify: `frontend/src/styles/news.css`
- Modify: `frontend/src/test/news-liquid-bars.contract.test.ts`

**Interfaces:**
- Consumes: `--news-light-angle`, `--news-light-alpha`,
  `--news-dispersion-left`, `--news-dispersion-right`, and the bounded
  `--news-splay`.
- Produces: upper-left dispersion and highlight with no centered translation.

- [ ] **Step 1: Record the pre-existing dirty-file state**

Run before editing:

```powershell
git diff -- frontend/src/styles/news.css frontend/src/test/news-liquid-bars.contract.test.ts
```

Keep this output in the task report. It is the ownership boundary: existing
Falling Leaves, popover, typography, and shipping-surface changes must remain
byte-for-byte unchanged.

- [ ] **Step 2: Write the failing directional-glint contract**

Add:

```ts
it("anchors a small asymmetric glint at the upper-left corner", () => {
  const dispersion =
    newsCss.match(/\.news-glass-shine::before\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
  const highlight =
    newsCss.match(/\.news-glass-shine::after\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

  expect(dispersion).toMatch(/top:\s*1px;/);
  expect(dispersion).toMatch(/left:\s*clamp\(4px,\s*1\.4%,\s*16px\);/);
  expect(dispersion).toMatch(/transform:\s*rotate\(-10deg\);/);
  expect(dispersion).toMatch(/transform-origin:\s*left center;/);

  expect(highlight).toMatch(/top:\s*-8%;/);
  expect(highlight).toMatch(/left:\s*-1%;/);
  expect(highlight).toMatch(/border-radius:\s*0 0 72% 0;/);
  expect(highlight).toMatch(
    /radial-gradient\(ellipse 120% 105% at 0 0,/,
  );
  expect(highlight).toMatch(/transform:\s*rotate\(-4deg\);/);
  expect(highlight).toMatch(/transform-origin:\s*top left;/);

  for (const layer of [dispersion, highlight]) {
    expect(layer).not.toMatch(/left:\s*50%/);
    expect(layer).not.toMatch(/translateX\(-50%\)/);
  }
});
```

- [ ] **Step 3: Run the contract and verify RED**

Run:

```powershell
npm.cmd test -- --run src/test/news-liquid-bars.contract.test.ts
```

Expected: FAIL because both pseudo-elements currently use `left: 50%` and
`translateX(-50%)`, and the highlight mask is centered.

- [ ] **Step 4: Implement the corner dispersion**

Replace only `.news-glass-shine::before`:

```css
.news-glass-shine::before {
  position: absolute;
  top: 1px;
  left: clamp(4px, 1.4%, 16px);
  width: var(--news-splay);
  height: 2px;
  border-radius: 999px;
  box-shadow:
    var(--news-dispersion-left) 0 5px rgb(74 227 255 / 62%),
    var(--news-dispersion-right) 0 5px rgb(255 125 216 / 42%);
  content: "";
  transform: rotate(-10deg);
  transform-origin: left center;
}
```

- [ ] **Step 5: Implement the diagonal micro-glint**

Replace only `.news-glass-shine::after`:

```css
.news-glass-shine::after {
  position: absolute;
  top: -8%;
  left: -1%;
  width: var(--news-splay);
  height: 62%;
  border-radius: 0 0 72% 0;
  background:
    linear-gradient(
      var(--news-light-angle),
      rgb(255 255 255 / var(--news-light-alpha)),
      rgb(255 255 255 / 8%) 42%,
      transparent 82%
    );
  content: "";
  filter: url(#news-liquid-refraction);
  -webkit-mask-image:
    radial-gradient(
      ellipse 120% 105% at 0 0,
      #000 0%,
      rgb(0 0 0 / 76%) 30%,
      transparent 78%
    );
  mask-image:
    radial-gradient(
      ellipse 120% 105% at 0 0,
      #000 0%,
      rgb(0 0 0 / 76%) 30%,
      transparent 78%
    );
  transform: rotate(-4deg);
  transform-origin: top left;
}
```

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```powershell
npm.cmd test -- --run src/test/news-liquid-bars.contract.test.ts src/components/news/newsGlassSettings.test.ts src/pages/NewsPage.test.tsx
```

Expected: all focused tests PASS.

- [ ] **Step 7: Verify the dirty-file ownership boundary**

Run:

```powershell
git diff -- frontend/src/styles/news.css frontend/src/test/news-liquid-bars.contract.test.ts
```

Confirm the only new changes beyond the Step 1 snapshot are:

- the new directional-glint contract;
- the two pseudo-element replacements.

Do not stage or commit these two dirty files. Report their exact paths as
intentionally uncommitted so the user's existing work remains intact.

---

### Task 3: Verify the Patch

**Files:**
- Verify only.

**Interfaces:**
- Consumes the completed mapping and CSS patch.
- Produces fresh verification evidence.

- [ ] **Step 1: Run typecheck**

```powershell
cd frontend
npm.cmd run typecheck
```

Expected: exit code 0.

- [ ] **Step 2: Run the complete frontend suite**

```powershell
npm.cmd test -- --run
```

Expected: all frontend test files and tests PASS.

- [ ] **Step 3: Run the production build**

```powershell
npm.cmd run build
```

Expected: Vite exits 0 and writes `frontend/dist`.

- [ ] **Step 4: Review the final diff**

Verify that:

- `newsGlassSettings.ts` contains only the Splay formula change;
- `news.css` preserves every pre-existing dirty hunk outside the two shine
  pseudo-elements;
- `news-liquid-bars.contract.test.ts` preserves every pre-existing dirty hunk
  outside the new contract;
- no new transition, animation, dependency, component, or stylesheet exists.
