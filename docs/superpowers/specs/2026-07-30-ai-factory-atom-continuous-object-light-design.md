# AI Factory Atom — Continuous Object-Only Radial Light and Shard Micro-Orbits

Date: 2026-07-30

## Context

The current Atom wave is smooth from the core to ring 1, but the transitions
from ring 1 to ring 2 and from ring 2 to ring 3 read as pauses. The current
implementation assigns the core and three rings to four fixed phase slots.
Even with an afterglow, the fixed slots make the outer transitions feel like
separate beats instead of one radial event.

The background also remains darker than desired.

The reference video also gives the atom's smallest blocks a restrained,
repeating local motion. The core and rings move correctly as assemblies in the
current version, but their individual blocks remain too rigid relative to one
another.

## Goal

Create one continuous outward-moving radial light field whose timing is derived
from every shard's physical distance from the centre. Only existing core and
ring blocks may become brighter. Empty space between rings must remain empty
and dark.

The background should be visibly brighter and warmer while retaining a dark
cinematic vignette.

Add deterministic, closed micro-orbits to the individual small blocks without
changing the established motion, scale, or silhouette of the core and three
rings.

## Non-goals

- Do not add a visible shockwave sphere, shell, disc, line, sprite, or particle
  layer in the gaps between rings.
- Do not add new geometry or a new light source that travels through empty
  space.
- Do not change seeded shard placement, ring geometry, camera composition,
  interaction, assembly-level core/ring rotation speeds, responsive layout, or
  fallback behavior.
- Do not flatten the dark bevels and material variation of individual blocks.
- Do not add random per-frame jitter, Brownian drift, free-floating debris, or
  an orbit whose centre moves away from a block's seeded base transform.

## Approved Visual Direction

The selected direction is the revised Option B:

- A single continuous radial phase replaces the four fixed band slots.
- The outgoing ring retains a restrained afterglow while the next ring's
  existing blocks begin a soft approach response.
- The overlap is visible only on object surfaces. There is no bridge glow in
  empty space.
- Global bloom follows the object energy with temporal smoothing so a change in
  the dominant ring cannot create a brightness step.
- The base background changes from `#080706` to `#110d0b`. A dark vignette
  keeps the corners near the previous cinematic black.
- Each existing small block follows a deterministic closed local ellipse around
  its seeded base transform and performs a small periodic self-tilt.
- The user-approved production calibration is `4%` translation amplitude and
  `0.35×` time scale, with deterministic per-instance phase,
  frequency, ellipse ratio, and tilt phase.

## Individual Shard Micro-Motion

### Scope and coordinate space

Micro-motion applies only to the individual instanced blocks in the core and
three rings. It is evaluated after each block's seeded base transform and
before the existing assembly-level transform. The core and rings therefore
retain their current global paths, while nearby blocks move subtly relative to
one another.

The orbit centre is always the block's seeded base position. Translation uses
a closed ellipse in a stable shard-local tangent plane; it must not accumulate
over time or alter the mean position. The additive highlight instance for a
block must receive the exact same displaced transform as its base material so
the highlight never separates into a ghost copy.

### Deterministic motion model

Each instance receives stable motion parameters derived from its instance index
and the existing seeded world construction:

- `phase`: uniformly distributed through `[0, 2π)`;
- `frequency`: core `0.78–1.30`, rings `0.62–1.02`;
- `ellipseRatio`: core `0.42–0.76`, rings `0.38–0.66`;
- `tiltPhase`: uniformly distributed through `[0, 2π)`.

At the approved `0.35×` time scale, the orbital angle is:

`theta = elapsedSeconds × 0.35 × frequency × 2π + phase`

The primary translation radius is `0.04 × shard characteristic size`. The
secondary radius is the primary radius multiplied by `ellipseRatio`. A
periodic self-tilt uses the second harmonic:

`tilt = sin(2 × theta + tiltPhase) × 0.16 radians`

These values are fixed production calibration, not exposed as new UI controls.
The motion is periodic and deterministic for a given seed. Reloading the page
must recreate the same block paths.

### GPU execution and silhouette limits

Apply translation and self-tilt in the vertex shader for both the opaque shard
material and its existing additive overlay. Do not rewrite thousands of
instance matrices in the animation loop.

The shader receives elapsed time through one shared uniform update per frame.
All per-instance motion parameters are created once during world construction
as instanced attributes or a deterministic equivalent compatible with Three.js
`0.164.1`.

The `4%` amplitude is measured from each shard's own characteristic size, not
from ring radius. This keeps the aggregate core/ring silhouette stable and
prevents the rings from visibly breathing, thickening, or shedding blocks.

## Wave Model

### Physical radial phase

Use each shard's actual distance from the atom centre as the source of truth:

- Core shards use their generated radius `r`.
- Ring shards use their generated radial distance `rr`.
- Normalize both through one shared, monotonic radial transfer from the centre
  to the outer edge of ring 3. The transfer may be eased to compress intervals
  that contain no geometry, but it must never reorder two shards by radius.
- Store the normalized value on each instance during world construction.

The animation front advances through that normalized radial domain over one
cycle. No fixed `bandSlots` participate in the wave calculation.

Calibration must preserve the already-smooth core → ring 1 transition. The
phase interval from ring 1 → ring 2 and from ring 2 → ring 3 must not exceed the
effective illuminated interval from the core shell → ring 1.

### Object-only overlap

The signal remains asymmetric:

- A soft approaching shoulder begins lifting existing blocks on the incoming
  ring.
- A longer, restrained tail keeps existing blocks on the outgoing ring
  visible.
- The shoulder and tail must overlap across the physical distance between
  rings 1–2 and rings 2–3.
- At each outer-ring hand-off sample, either the outgoing or incoming ring must
  retain at least `0.20` normalized object energy; there must be no fully dark
  hand-off frame.

The overlap changes only the instance colors, existing additive shard overlays,
and the core's existing light response. Empty pixels in the gaps receive no
new mesh, sprite, or travelling light.

### Bloom smoothing

Replace direct per-frame assignment from the instantaneous maximum energy with
an FPS-independent damped energy value. The target energy still comes only
from illuminated core/ring blocks. The damping must eliminate derivative
steps at dominant-band hand-offs without noticeably delaying the outward wave.

The smoothed value controls the existing bloom strength only. It must not
create an independent visible pulse.

## Background

- CSS base background: `#110d0b`.
- Three.js scene/fog background: `0x110d0b`.
- Preserve the warm central atmosphere but increase it only enough to reveal
  silhouettes and dark material faces.
- Retain a vignette whose outer corners remain substantially darker than the
  centre.
- Do not compensate for the brighter field by making the shards uniformly
  white.

## Performance

The fix must not introduce new per-frame matrices, colors, vectors, arrays, or
geometry allocations.

Existing instance buffers may be updated, but the implementation should avoid
rebuilding the world or changing quality profiles as part of a normal wave
handoff.

Micro-motion adds only shared time-uniform updates per frame. Per-instance
phase/frequency/ellipse/tilt data is allocated once, uploaded once, and reused.
The implementation must not call `setMatrixAt` or mark `instanceMatrix` dirty
from the animation loop.

## Accessibility

`prefers-reduced-motion: reduce` keeps the existing static object-energy state.
The travelling radial front and bloom damping do not advance in reduced-motion
mode.

Shard micro-orbit time is also frozen in reduced-motion mode. The frozen pose
uses the seeded base transforms without translation or self-tilt, matching the
micro-motion-off state from the approved demo.

## Verification

### Static contract

A focused contract must fail against the current implementation and pass only
when it proves:

- the brighter `#110d0b` CSS and Three.js backgrounds;
- physical-radius phase assignment for core and ring shards;
- fixed `bandSlots` are absent from travelling-wave timing;
- bloom uses an FPS-independent damped object-energy value;
- travelling updates remain guarded by reduced-motion;
- no new travelling shell, shockwave geometry, gap sprite, or gap light is
  introduced.
- opaque and additive shard materials use the same GPU micro-orbit transform;
- the approved `4%` amplitude, `0.35×` time scale, deterministic parameter
  ranges, and second-harmonic `0.16`-radian tilt are present;
- the animation loop updates a shared time uniform and does not rewrite
  per-instance matrices;
- reduced-motion disables both micro-translation and self-tilt.

### Runtime and visual checks

Serve the trial artifact over localhost and verify:

- WebGL canvas ready, fallback hidden, and browser log count zero;
- one complete 4.8-second cycle captured in at least 48 consecutive frames;
- core → ring 1, ring 1 → ring 2, and ring 2 → ring 3 all show continuous
  outgoing/incoming object energy;
- no frame shows a luminous bridge in empty space;
- block boundaries and dark bevel faces remain visible at peak energy;
- centre/background are brighter while the corners remain dark;
- consecutive close-up frames show individual tiny blocks tracing small,
  out-of-phase closed paths rather than moving as one rigid shell;
- the core and ring envelopes remain stable with no visible breathing,
  thickening, drift, or detached additive highlights;
- a reload reproduces the same per-block motion paths;
- real drag and wheel zoom remain functional;
- reduced-motion holds a static energy state.

## Delivery and Recovery

Develop and verify in a writable trial copy first. Before replacing the user's
target, create a byte-exact long-path-safe backup and verify its SHA-256.
Replace the target only after that verification succeeds, then confirm the
trial file, delivered target, and served HTTP payload have identical SHA-256
hashes.
