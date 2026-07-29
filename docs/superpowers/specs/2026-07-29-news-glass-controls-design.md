# News Glass Controls — Design

## Goal

Replace the static glass readout on `/news` with a compact, dark control
panel inspired by the supplied reference. Every control must update the
existing layered glass material immediately. Remove the grid lines from the
animated page background while preserving the aurora and caustic motion that
make refraction visible.

## Scope

- Keep the current News page composition, real news loading, topic filters,
  refresh action, glass layers, animated auroras, and caustic sweeps.
- Keep the `Nguyên bản` and `Tinh chỉnh` mode buttons as presets.
- Replace the current Tint/Blur/Displacement definition list with interactive
  controls.
- Remove the background grid completely.
- Remove the continuous white perimeter and thick white lower edge from every
  glass surface.
- Do not introduce Canvas, WebGL, a UI library, or a new stylesheet.

## Control Panel

The existing `.news-mode-panel` remains the container. Its content becomes a
dark translucent instrument panel with two areas:

1. A Light row containing a compact visual light dial, an angle readout, and
   an intensity readout.
2. Five labeled range rows: Refraction, Depth, Dispersion, Frost, and Splay.

Each range row uses three columns: label, slider, numeric value. The track is
neutral charcoal, the filled portion is cyan-blue, and the thumb is white.
Values update while dragging. Keyboard interaction remains native through
`input[type="range"]`, with visible focus treatment and an accessible label.

On narrow screens, the panel remains one column and keeps controls large
enough to operate without horizontal scrolling.

## State and Presets

`NewsPage` owns one `GlassSettings` object:

- `lightAngle`: 0–360 degrees
- `lightIntensity`: 0–100 percent
- `refraction`: 0–100
- `depth`: 0–100
- `dispersion`: 0–100
- `frost`: 0–100
- `splay`: 0–100

`Nguyên bản` and `Tinh chỉnh` each load a complete preset object. Selecting a
preset updates every control and the glass in one render. Moving any control
retains the currently selected preset label as a starting mode but applies the
custom value immediately; no save action is required.

## Visual Mapping

- Light angle rotates the directional highlight gradient.
- Light intensity controls highlight opacity.
- Refraction maps to the SVG displacement scale.
- Depth controls the glass shadow strength and underside edge.
- Dispersion controls cyan/magenta color separation around the rim.
- Frost maps to backdrop blur and white tint strength.
- Splay controls the width of the directional highlight.

Mappings are bounded so the content remains readable at every slider extreme.
The glass effect stays on decorative layers; text and icons never receive the
SVG filter.

## Glass Edge Treatment

The current full-perimeter white border and symmetric white inset rim make the
material read as coated plastic. Remove both from `.news-glass-shine`, and
remove the active tab's white outer outline. Retain three quieter depth cues:

- a localized directional highlight across part of the upper edge;
- a subtle cool/dark underside edge controlled by Depth;
- the existing soft ambient shadow beneath the object.

No glass surface may show an uninterrupted white outline. Active tabs remain
identifiable through their cyan-to-blue fill, text contrast, and colored
shadow rather than a white ring.

## Directional Micro-Glint

The primary highlight must not sit at the horizontal center of a glass
surface. Anchor it at the upper-left corner and let it fall diagonally toward
the lower-right, following the live Light angle.

Keep the highlight deliberately small:

- its width stays between 8% and 26% as Splay moves from 0 to 100;
- its brightest point starts at the upper-left edge;
- its opacity fades asymmetrically across both axes;
- its cyan/magenta dispersion remains confined to the same corner;
- it never forms a centered pill, a horizontal bar, or a continuous edge.

Light Angle continues to control direction, Light Intensity controls
brightness, and Splay controls the bounded glint footprint. The same material
logic applies to command bars, controls, topic capsules, and feed glass, with
the footprint scaling inside each surface.

## Background

Remove `.news-liquid-ambient::before`, including both linear gradients and its
64px background sizing. Keep the smooth base gradient, aurora fields, prism,
and caustic sweeps.

## Performance and Accessibility

- Slider changes update React state and CSS custom properties only.
- Existing ambient animation continues to use transform and opacity.
- Existing `prefers-reduced-motion` behavior remains intact.
- Every range has a programmatic name, current numeric value, and keyboard
  support.
- Controls maintain readable contrast against the dark panel.

## Testing

- Component tests verify both presets load their expected values and moving a
  slider updates the live glass settings.
- Contract tests verify all seven controls exist, the relevant CSS variables
  drive glass layers, the grid background rules are absent, and no continuous
  white glass border or active white outline remains.
- Contract tests verify the highlight is upper-left anchored, has no centered
  `translateX(-50%)`, and the Splay mapping remains within 8%–26%.
- Existing News loading, topic filtering, refresh, typecheck, build, and full
  frontend tests must continue to pass.
