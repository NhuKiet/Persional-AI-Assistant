# AI Factory Atom — Fidelity and Energy-Wave Refinement

## Purpose

Refine the existing standalone `ai-factory-atom.html` so its reactor matches
the Opus 5 reference sequence more closely. The work is limited to the Atom
scene already produced in the Claude output directory. It does not redesign the
page copy, navigation, metrics, or interaction model.

## Reference Evidence

The comparison is based on:

- 50 consecutive Opus 5 frames sampled at 10 fps from 14.5–19.5 seconds of the
  supplied 60 fps video.
- 30 consecutive browser screenshots of the current implementation covering
  more than one complete 5.4 second wave cycle.

The reference shows:

- A core that alternates between textured ivory/lavender and a near-white,
  internally powered state.
- A soft white hotspot and halo at the center without losing individual shard
  detail.
- Bright material bands that travel around the orbital belts rather than
  brightening an entire belt uniformly.
- An inner belt visually close to the core and two wider belts that remain
  inside a compact overall silhouette.
- Orbital belts that read as two to three interleaved layers of blocks.
- Deep near-black negative space, bright key-lit faces, lavender lower/rim
  faces, and selected warm reflections.

The current implementation fails to communicate the wave because the angular
phase variation on a ring is only about `±0.022`, while the wave width is
`0.11`. Nearly every shard on a ring therefore receives similar brightness at
the same time. The core wave is also assigned by true three-dimensional radius,
so its early stages are hidden behind opaque outer shards.

## Approved Direction

Use the existing instanced Three.js architecture with a two-layer energy source
and a CPU-updated spatial wave. This avoids the fragility of custom shader
injection while keeping the scene in one authored HTML file.

The implementation must preserve:

- Seeded and reproducible shard placement.
- Shared instanced geometry and low draw-call count.
- Delta-time animation.
- Existing pointer drag, parallax, bounded zoom, quality profiles, mobile
  layout, WebGL fallback, and reduced-motion path.

## Geometry and Density

Keep the core radius at approximately `1.95`. Retune the three orbital belts
using these starting values:

| Belt | Count | Radius | Thickness |
| --- | ---: | ---: | ---: |
| Inner | 760 | 2.80 | 0.22 |
| Middle | 880 | 3.35 | 0.24 |
| Outer | 720 | 3.70 | 0.21 |

The table is a calibrated starting point, not an immutable constant. Visual
verification may adjust each value by up to 10 percent when needed to match the
reference silhouette or maintain performance.

Orbital shard size should start near `0.05–0.13`, retain the one-segment bevel,
and use enough radial and vertical jitter to create two to three visible block
layers. The innermost belt must appear close to or partially overlap the
projected core boundary at common viewing angles. The outermost silhouette
should remain around `1.85–1.95×` the apparent core radius.

## Lighting and Tonal Model

The core becomes a two-layer energy source:

1. Existing instanced core shards remain the visible textured shell.
2. A compact, depth-tested white-hot sprite and the existing central point
   light provide energy visible through gaps between shards.

The point light must be retained as scene state so its intensity can follow the
wave. At rest, the core remains readable as warm ivory with lavender and warm
facets. At wave peak, the center approaches white and produces a soft halo, but
block boundaries and bevel shadows must remain visible.

Increase contrast by:

- Reducing the ambient-light intensity from the current `2.0` toward
  approximately `1.0–1.2`.
- Darkening the generated environment base from `#4a4645` toward a charcoal
  value around `#292627`.
- Reducing the warm CSS background halo from opacity `0.28` toward
  approximately `0.12–0.16`.
- Lowering resting ring emissive light while retaining a strong white-hot wave
  crest.
- Keeping or slightly strengthening the directional key light so lit faces
  become brighter while unlit bevels remain near black.

Bloom is subordinate to the spatial lighting. It may intensify at the local
wave peak but must not act as the primary animation or turn the core into a
featureless disk.

## Wave Model

Use one repeating capability cycle of approximately `3.2–3.6` seconds:

1. A compact hotspot ignites at the core center.
2. A bright shell expands across visible core shards.
3. The inner belt receives the wave.
4. The middle belt follows.
5. The outer belt follows.
6. The scene returns briefly to its high-contrast resting state.

Core activation remains radial, but the visible signal must be reinforced by
point-light intensity, hotspot opacity, and material emissive intensity so the
source is visible before the shell reaches the surface.

Each ring stores a normalized angular coordinate per shard. After the radial
delay reaches that ring, a bright band sweeps along the ring circumference.
The band should occupy roughly 18–28 percent of a circumference, use the
ring's rotation direction, and overlap adjacent rings enough to read as one
outward energy event. It must not illuminate every shard on a ring uniformly.

Per-frame updates must:

- Reuse typed arrays and existing material objects.
- Avoid allocating `Color`, `Vector`, matrix, or array objects in the render
  loop.
- Upload instance colors only while a wave is active or while resetting from
  the previous active frame.
- Use frame delta and clamp stalls as the existing animation does.

## Reduced Motion and Quality Profiles

When `prefers-reduced-motion` is active:

- Disable wave travel, ring rotation, automatic core rotation, and parallax.
- Keep a static warm-white internal hotspot and enough contrast to communicate
  an energy source.
- Do not run continuous per-instance color uploads.

Quality profiles retain the same overall appearance:

- `high` uses the full approved counts and bloom.
- `balanced` scales counts and bloom resolution as it does now.
- `low` scales counts, disables bloom, and uses the compact hotspot plus
  point-light treatment as the inexpensive fallback.

## Verification

Implementation follows a red-green workflow:

1. Extend the visual-fidelity contract so it fails on the current ring counts,
   radii, phase model, lighting floor, and lack of a controllable internal heat
   source.
2. Implement the smallest coherent changes that satisfy those requirements.
3. Run the contract and JavaScript syntax checks.
4. Render the target file through a local HTTP server and confirm no WebGL or
   console errors.
5. Capture at least 30 consecutive browser frames spanning one full capability
   cycle.
6. Compare contact sheets against the 10 fps Opus 5 sequence.

The final sequence is accepted when:

- The core visibly changes from textured/resting to white-hot during every
  cycle.
- A viewer can identify the direction center → core surface → inner belt →
  middle belt → outer belt without reading the code.
- At least one bright segment travels along a ring rather than the whole ring
  brightening at once.
- The three belts appear materially denser than the current build.
- The inner projected gap is substantially smaller and the overall silhouette
  remains compact.
- Background negative space stays near black and bevel shadow faces remain
  visible.
- The browser reports no runtime errors and the page remains responsive at the
  existing desktop, tablet, and mobile checkpoints.

## Deliverables

- Updated `ai-factory-atom.html` in the supplied Claude `outputs` directory.
- A recovery copy of the immediately preceding HTML.
- Updated visual-fidelity contract.
- Reference and final contact sheets retained in the writable visualization
  workspace for comparison.
