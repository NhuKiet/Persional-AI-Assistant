# News Botanical Leaves Background Design

**Date:** 2026-07-29

**Status:** Approved direction; awaiting written-spec review

**Selected direction:** A — “Kính thực vật”

## Goal

Replace the coarse, opaque autumn-leaf canvas with a restrained botanical
background that makes the liquid-glass surfaces easier to read. Leaves should
feel like translucent material moving through depth, not flat clip-art moving
over the interface.

The News feed, glass controls, topic controls, loading behavior, and article
content remain unchanged.

## Visual Direction

The background uses sparse, asymmetric leaves with soft gradients and a faint
light vein. There is no black outline. Most leaves stay behind the glass
surfaces, where blur and refraction reveal their motion.

The four leaf colors are deliberately desaturated:

- copper: `#b77a59`;
- muted gold: `#c0a36b`;
- sage: `#7f8d73`;
- dusty rose: `#aa7772`.

These values become News-scoped CSS custom properties on `.news-page`, then
the canvas reads their computed values. The component does not duplicate the
palette as TypeScript literals.

The animated aurora remains, but its opacity is reduced:

- shared cyan layer: `0.76` to `0.62`;
- violet: `0.64` to `0.52`;
- coral: `0.58` to `0.48`;
- gold: `0.48` to `0.40`;
- prism: `0.78` to `0.60`;
- ambient white overlay: `0.72` to `0.55`.

Caustic sweeps and all glass layers remain unchanged.

## Density and Depth

Density is derived from the canvas width rather than a fixed prop:

| Canvas width | Total leaves |
| --- | ---: |
| below 700 px | 8 |
| 700–1099 px | 11 |
| 1100 px and above | 14 |

The population is divided into three depth bands:

| Band | Share | Size | Opacity | Fall speed | Baked blur |
| --- | ---: | ---: | ---: | ---: | ---: |
| Far | 35% | 4–7 px | 0.08–0.16 | 8–14 px/s | 1.2 px |
| Mid | 50% | 7–11 px | 0.14–0.26 | 12–20 px/s | 0.35 px |
| Near | 15% | 10–15 px | 0.20–0.34 | 18–27 px/s | none |

The shares are targets. The model floors far leaves, assigns at least one near
leaf using the floored near share, and gives the exact remainder to the mid
band. Near leaves are therefore rare, and no leaf exceeds the current design’s
visual footprint.

## Leaf Shape

Each leaf sprite is asymmetric:

- a tapered tip and slightly offset base;
- unequal left and right Bézier lobes;
- a diagonal translucent gradient;
- one low-opacity light vein;
- no dark stroke, hard perimeter, or drop shadow.

Twelve sprites are cached at mount time: four palette colors across the three
depth bands. Blur is baked into far and mid sprites once, rather than applying
`ctx.filter` to every leaf on every frame.

## Motion

Motion is time-based and continuous:

- base wind moves right at 3–7 px/s;
- two low-frequency sine waves provide 2–6 px/s of changing drift;
- rotation stays between `-0.18` and `0.18` rad/s;
- horizontal flutter scales the sprite between `0.78` and `1`;
- delta time is capped at `0.05 s`.

Leaves spawn above the viewport with a small horizontal overscan. They fade in
through the first 12% of their route and fade out through the last 12%. After
fully leaving the lower or side boundary, a leaf respawns above the viewport.
There is no visible edge wrapping or teleport across the canvas.

The particle generator uses an internal seeded random source. The scene remains
natural but reproducible for tests and does not change character on every
React render.

## Architecture

### `fallingLeavesModel.ts`

A DOM-free module owns:

- depth-band configuration;
- width-to-density mapping;
- the seeded random generator;
- particle creation and respawn;
- time-step updates;
- route-edge opacity.

It exports typed pure functions. Canvas drawing and browser APIs do not enter
this module.

### `FallingLeaves.tsx`

The React component owns:

- canvas and DPR sizing, capped at DPR 2;
- reading the News-scoped palette;
- sprite-cache creation;
- drawing cached sprites;
- `ResizeObserver`, animation-frame, visibility, and motion-preference
  lifecycles.

The public component takes no density prop. Density is part of the responsive
model contract.

### `news.css`

The existing News stylesheet owns:

- the four leaf palette variables;
- the approved ambient-opacity reductions;
- the existing full-page, pointer-events-none canvas placement.

No stylesheet, dependency, or animation library is added.

## Lifecycle and Performance

- Only `transform`-equivalent canvas operations and alpha change per frame.
- Gradient construction and blur happen only when the sprite cache is built.
- `requestAnimationFrame` pauses while the document is hidden and resumes
  without a large delta-time jump.
- Resize reconciles the responsive particle count; it does not install another
  animation loop.
- Unmount cancels the frame, disconnects `ResizeObserver`, and removes media
  and visibility listeners.

## Reduced Motion

When `prefers-reduced-motion: reduce` is active:

- no animation frame loop runs;
- exactly five leaves are drawn as a static composition;
- resize redraws that static composition;
- changing the media query at runtime switches cleanly between static and
  animated modes.

Reduced motion preserves the botanical atmosphere without continuous movement.

## Failure Behavior

If canvas, its 2D context, `ResizeObserver`, or animation-frame APIs are
unavailable, the component leaves the canvas empty and the News interface
continues normally. Background decoration never blocks content or controls.

## Testing

### Pure model tests

- density is 8, 11, and 14 at the three width ranges;
- generated leaves respect the size, speed, opacity, and depth-band bounds;
- update motion is deterministic for a fixed seed and delta;
- opacity reaches zero at route entry and exit;
- respawn begins above the viewport instead of wrapping to the opposite edge.

### Component tests

- DPR is capped at 2;
- animated mode schedules one frame loop and cleans it on unmount;
- hidden documents pause animation and resume it;
- reduced motion draws five static leaves and schedules no loop;
- resize changes density without creating a second loop;
- missing canvas context is a harmless no-op.

### CSS and integration checks

- the canvas remains behind News content and ignores pointer events;
- palette variables and approved ambient opacities are contracted;
- existing glass variables and pseudo-elements remain unchanged;
- full frontend tests, typecheck, and production build pass.

### Visual QA

Inspect `/news` at widths 1440, 768, and 390 px. Confirm:

- no dark leaf outlines;
- no visible edge teleport;
- glass remains the highest-contrast material;
- small controls are not obscured by near leaves;
- reduced motion shows a static composition.

## Ownership Boundary

The implementation may change only:

- `frontend/src/components/news/FallingLeaves.tsx`;
- a new `frontend/src/components/news/fallingLeavesModel.ts`;
- their focused tests;
- the leaf palette, ambient opacity, and canvas rules in
  `frontend/src/styles/news.css`;
- narrowly scoped News CSS contracts.

It must preserve all unrelated uncommitted News, Falling Leaves demo, popover,
typography, feed, and directional micro-glint work byte-for-byte.
