# News Liquid Glass Bars — Design Specification

**Date:** 2026-07-28

**Status:** Approved for planning

**Surface:** `NewsPage` command bar and topic-filter bar only

## 1. Goal

Rebuild the two control groups at the top of the AI & Robotics news page so
they closely match the supplied reference image:

1. the full-width command bar containing Back, page title, and Refresh;
2. the row of five standalone topic capsules.

The result must preserve the reference's bright white liquid-glass appearance,
including its soft volume, double rim, specular highlight, cool shadow, and
cyan-to-blue active state. It must remain responsive and usable rather than
being a fixed screenshot recreation.

The news list, cards, data fetching, filter behavior, refresh behavior, and all
content beneath these controls are outside this change.

## 2. Approved Direction

Use a hybrid rendering approach:

- CSS owns layout, geometry, typography, gradients, blur, borders, and shadows.
- A subtle SVG refraction layer may be applied only to decorative glass
  highlights and rims.
- Refraction must not distort text, icons, focus rings, or click targets.
- The CSS result is the complete fallback when SVG filter support is missing or
  disabled.
- The visual stays permanently light on the News page, independently of the
  application's light or dark theme.

The refraction is intentionally restrained. At rest, the bars should read like
the reference image. The "liquid" quality should become more noticeable only
through the way highlights bend around the rounded edges and respond to a
small interaction-state change.

## 3. Reference Geometry

The reference image is 1309 × 202 px. At that presentation size, target the
following proportions:

### Command bar

- Outer horizontal inset: approximately 17 px.
- Outer height: approximately 86 px, including its visible rim and shadow.
- Main glass body: approximately 76 px high.
- Outer radius: approximately 28 px.
- Back control: approximately 64 × 58 px including its bright outer rim; its
  interactive body remains at least 52 × 52 px.
- Refresh control: approximately 152 × 58 px including its rim.
- Title aligns vertically with the two controls and expands into the remaining
  middle space.

### Topic capsules

- Row begins approximately 21 px below the command bar's main body.
- Capsules are centered as one group and separated by approximately 14–18 px.
- Capsule height is approximately 54 px including rim and shadow.
- Width follows the label rather than being identical for all topics:
  `Tất cả` is the compact capsule, while longer labels receive wider capsules.
- Capsule radius is fully pill-shaped.
- The active `Tất cả` state uses a cyan → sky blue → royal blue horizontal
  gradient, white text, a bright top rim, and a cool blue shadow.

These measurements are calibration targets for the supplied desktop viewport,
not hard constraints at every viewport width.

## 4. Visual Construction

### 4.1 Shared glass material

Both control groups use the same News-local material tokens:

- near-white translucent fill;
- cool blue-gray outer edge;
- bright white inner rim;
- a concentrated upper specular highlight;
- faint lower-edge shading to suggest thickness;
- soft blue-gray ambient shadow;
- backdrop blur and mild saturation.

The material is constructed from layered backgrounds and pseudo-elements. The
outer edge, inner rim, and specular highlight must remain independently
tunable so visual matching does not depend on a single opaque gradient.

### 4.2 Command bar

The command bar is one continuous rounded glass body. Back and Refresh remain
independent glass capsules nested within it. Decorative layers sit behind the
interactive content and have `pointer-events: none`.

The title uses the existing Vietnamese-capable display font and retains:

- text: `Tin tức AI & Robotics`;
- dark navy color;
- strong display weight;
- compact negative tracking comparable to the reference.

The Back icon should use a clean stroked left arrow, not a text glyph, so its
weight and alignment are stable across platforms. The Refresh icon should use
a clean two-stroke circular arrow matching the reference instead of a filled
symbol.

### 4.3 Topic row

The topic row has no shared background panel. Each topic is a standalone glass
capsule:

- `Tất cả`
- `Model mới`
- `Nghiên cứu`
- `Robotics`
- `Cộng đồng`

Inactive capsules use clear white glass with navy text. The selected capsule
uses the reference's blue gradient and white text. Selection moves without
changing the row's geometry.

### 4.4 Refraction layer

If used, the SVG filter applies to a dedicated decorative pseudo-element or
overlay, never the element containing text or icons. Its displacement scale is
kept low enough that:

- straight edges do not visibly wobble;
- the inner highlight appears gently pulled around rounded corners;
- no text halo or color fringing is introduced;
- the visual remains stable while idle.

Hover/focus may slightly shift highlight position or intensity. It must not
continuously animate. On small screens and under reduced-motion preferences,
the displacement is reduced or removed.

## 5. Interaction States

### Rest

- Matches the reference's quiet, glossy white surface.
- Active topic remains immediately identifiable by color.

### Hover

- Slightly brighter edge and slightly deeper shadow.
- Maximum vertical movement: 1 px.
- No scale animation and no visible shape wobble.

### Focus

- Keyboard focus is clearly visible outside the glass edge.
- Focus styling is not clipped by the element's decorative layers.
- Focus does not rely on color alone.

### Pressed

- A very small downward movement or reduced shadow conveys physical press.
- `aria-pressed` remains the source of truth for topic selection.

### Disabled/loading

- Refresh remains legible while disabled.
- Loading state does not change control width or shift the title.

## 6. Responsive Behavior

### Desktop

- The command bar spans the existing News content container.
- Geometry is calibrated against the supplied 1309 px-wide reference.
- The five topic capsules are centered in one row.

### Tablet

- The command bar retains its single-row structure.
- Title flexes before action controls shrink below accessible target sizes.
- Topic gaps decrease before horizontal scrolling is introduced.

### Mobile

- Command bar height and radii reduce proportionally.
- Back and Refresh remain at least 44 × 44 CSS px.
- The title remains readable and may reduce font size but does not truncate
  unless the available width cannot accommodate all controls.
- Topic capsules stay on one line in a horizontally scrollable strip.
- The first and last capsules receive page-edge padding so their glass rims and
  focus outlines are not clipped.
- Refraction strength is reduced or disabled to protect rendering performance.

## 7. Accessibility and Compatibility

- Existing semantic `header`, `nav`, buttons, labels, and `aria-pressed`
  behavior are preserved.
- Decorative SVG/filter nodes are hidden from assistive technology.
- Text contrast is evaluated against the brightest plausible glass composite,
  not only the nominal background color.
- The active gradient must maintain readable white text.
- `prefers-reduced-motion: reduce` removes positional transitions and any
  animated highlight behavior.
- Browsers without `backdrop-filter` or SVG filter support receive an opaque
  translucent-white fallback with the same geometry and controls.

## 8. Code Boundaries

Expected implementation scope:

- `frontend/src/pages/NewsPage.tsx`
  - icon markup or decorative filter definition only where needed;
  - no news data-flow changes.
- `frontend/src/styles/news.css`
  - News-local material tokens;
  - bar geometry, visual layers, states, and responsive behavior.
- `frontend/src/pages/NewsPage.test.tsx`
  - semantic/structural contracts for the two bars and active topic behavior.
- Optional focused visual or CSS contract test if the project test setup
  supports it without brittle pixel snapshots.

Do not alter the global stylesheet import order. Do not restyle the article
list or introduce a new styling framework.

## 9. Verification

Implementation is complete only after all of the following pass:

1. Existing News page component tests pass.
2. Any added bar-specific tests pass.
3. The News page is visually inspected in a real browser at the reference
   desktop width, a tablet width, and a narrow mobile width.
4. The desktop bars are compared side-by-side with the supplied image for
   geometry, spacing, radii, rim brightness, shadows, typography, and active
   gradient.
5. Keyboard navigation exposes an unclipped focus indicator on every control.
6. Topic filtering and Refresh behavior remain unchanged.
7. Light and dark application themes both display the same bright News bars.
8. Reduced-motion mode removes movement without degrading the static design.
9. The browser console has no SVG filter, CSS, or React warnings.

## 10. Acceptance Criteria

- Only the two top control groups are materially restyled.
- At the reference desktop width, their silhouette and spacing closely match
  the supplied image.
- Glass has visible depth from a double rim, specular highlight, and cool
  shadow without looking gray or opaque.
- The active capsule matches the cyan-to-blue reference treatment.
- Refraction is subtle, decorative, and never harms legibility.
- The layout remains functional and visually coherent on mobile through a
  horizontally scrollable topic row.
- The appearance is independent of the application's theme.
- No existing News behavior regresses.
