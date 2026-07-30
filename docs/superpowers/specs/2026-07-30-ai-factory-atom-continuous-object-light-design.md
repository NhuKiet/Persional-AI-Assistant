# AI Factory Atom — Continuous Object-Only Radial Light

Date: 2026-07-30

## Context

The current Atom wave is smooth from the core to ring 1, but the transitions
from ring 1 to ring 2 and from ring 2 to ring 3 read as pauses. The current
implementation assigns the core and three rings to four fixed phase slots.
Even with an afterglow, the fixed slots make the outer transitions feel like
separate beats instead of one radial event.

The background also remains darker than desired.

## Goal

Create one continuous outward-moving radial light field whose timing is derived
from every shard's physical distance from the centre. Only existing core and
ring blocks may become brighter. Empty space between rings must remain empty
and dark.

The background should be visibly brighter and warmer while retaining a dark
cinematic vignette.

## Non-goals

- Do not add a visible shockwave sphere, shell, disc, line, sprite, or particle
  layer in the gaps between rings.
- Do not add new geometry or a new light source that travels through empty
  space.
- Do not change seeded shard placement, ring geometry, camera composition,
  interaction, rotation speeds, responsive layout, or fallback behavior.
- Do not flatten the dark bevels and material variation of individual blocks.

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

## Accessibility

`prefers-reduced-motion: reduce` keeps the existing static object-energy state.
The travelling radial front and bloom damping do not advance in reduced-motion
mode.

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

### Runtime and visual checks

Serve the trial artifact over localhost and verify:

- WebGL canvas ready, fallback hidden, and browser log count zero;
- one complete 4.8-second cycle captured in at least 48 consecutive frames;
- core → ring 1, ring 1 → ring 2, and ring 2 → ring 3 all show continuous
  outgoing/incoming object energy;
- no frame shows a luminous bridge in empty space;
- block boundaries and dark bevel faces remain visible at peak energy;
- centre/background are brighter while the corners remain dark;
- real drag and wheel zoom remain functional;
- reduced-motion holds a static energy state.

## Delivery and Recovery

Develop and verify in a writable trial copy first. Before replacing the user's
target, create a byte-exact long-path-safe backup and verify its SHA-256.
Replace the target only after that verification succeeds, then confirm the
trial file, delivered target, and served HTTP payload have identical SHA-256
hashes.
