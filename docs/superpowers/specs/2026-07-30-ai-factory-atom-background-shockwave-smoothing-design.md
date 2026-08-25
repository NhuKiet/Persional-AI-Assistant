# AI Factory Atom — Brighter Background and Smooth Radial Shockwave

**Date:** 2026-07-30  
**Status:** Approved direction, pending implementation

## Goal

Make the Atom scene easier to read against a subtly brighter cinematic
background, while removing the perceived pause and visual snap between the
core, inner ring, middle ring, and outer ring.

The effect must remain an outward radial shockwave. It must not return to the
previous angular highlight that travelled around each ring.

## Root Cause

The current loop uses a `6.4s` cycle and four evenly spaced slot centres. This
places successive peaks `1.6s` apart. Core shards occupy a phase interval, but
almost every shard in each orbital ring uses the same phase. The result is a
long visual trough followed by an almost simultaneous full-ring ignition.

The current additive values also clip the core and selected rings into solid
white shapes, making the transitions read as switches rather than material
moving through an energy field.

## Background Treatment

- Change the CSS background token from `#020203` to `#080706`.
- Change the Three.js scene background/fog colour to `0x080706`.
- Increase the warm radial atmosphere from alpha `0.14` to `0.22`.
- Preserve the existing vignette and near-black corners.
- Keep the canvas transparent so the CSS atmosphere and WebGL scene remain one
  continuous field.

The background should be visibly brighter in the negative space, but it must
remain darker than every resting ring face.

## Shockwave Timing

Use one continuous front with these constants:

```js
cycle: 4.8,
bandSlots: [0, 0.25, 0.5, 0.75],
coreSpread: 0.15,
ringPhaseSpread: 0.055,
tail: 0.17,
coreWidth: 0.065,
ringBandWidth: 0.065
```

The slot centres remain evenly spaced, preserving the authored four-beat
sequence. The shorter cycle reduces peak-to-peak delay from `1.6s` to `1.2s`.
The wider leading shoulder and longer afterglow create a controlled overlap
between consecutive bands.

## Radial Phase Distribution

The core keeps a centre-to-surface phase distribution across `coreSpread`.

Each orbital ring must no longer assign nearly the same phase to all shards.
Instead, phase is based on a shard's radial position through that ring's
thickness:

```js
const radialPhase = (rr - def.radius) / (def.thickness * 2);
waveAngle[i] = slot + radialPhase * CONFIG.wave.ringPhaseSpread + smallJitter;
```

This maps the inner edge to an earlier phase and the outer edge to a later
phase. Every angular part of the ring remains synchronized, but the bright
material grows smoothly across the belt's thickness rather than switching the
whole belt at once.

Phase values must wrap correctly at `0..1`, including the outer-ring-to-core
transition.

## Energy and Texture

Retain the new core overlay and copper/amber lighting direction, with these
restraints:

- Core overlay opacity: `0.18`.
- Ring overlay opacity: `0.48`.
- Core overlay range: `[0.60, 0.92]`.
- Ring overlay range: `[0.20, 0.72]`.
- Core energy scale: `5.0`.
- Heat sprite base scale: `2.1`.
- Broad glow opacity: `0.24` with bloom and `0.52` without bloom.

The brightest phase may reach white, but individual block boundaries and some
bevel shading must remain visible. No frame may turn the complete core or an
entire ring into a flat white silhouette.

## Motion and Performance

- Continue using delta time.
- Reuse typed arrays and existing instanced overlays.
- Do not allocate matrices, colours, or vectors inside the frame loop.
- Keep automatic quality downgrade, drag, parallax, zoom, visibility pause, and
  responsive layout unchanged.
- Preserve the static hot-core reduced-motion branch; reduced motion must not
  run the travelling shockwave.

## Verification

Add a focused regression contract before implementation. It must fail against
the current file and require:

- The approved brighter background values.
- A `4.8s` cycle and unchanged ordered slot centres.
- Radial ring phase distribution using `rr`, `def.radius`, and
  `ringPhaseSpread`.
- The approved overlap widths and non-clipping overlay values.
- The reduced-motion guard.

After implementation:

1. Run the contract and inline-module syntax check.
2. Capture at least 48 consecutive frames covering one full cycle.
3. Capture exact phase checkpoints near `0.00`, `0.125`, `0.25`, `0.375`,
   `0.50`, `0.625`, `0.75`, and `0.875`.
4. Confirm the visual hand-off never goes fully dark or snaps an entire ring on
   in one frame.
5. Confirm block texture remains visible at every peak.
6. Confirm the browser reports a ready canvas, no WebGL fallback, and no logs.
7. Back up the user's current file before replacing it.

