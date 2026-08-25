# AI Factory Atom — Prompt Design

## Purpose

Produce a copy-ready implementation prompt for a coding model such as Claude
Opus or Kimi. The model must create a polished, standalone Three.js experience
that visualizes the statement “Compute is converted into capability.”

This document defines the prompt itself. It does not implement the effect.

## Deliverable

The implementation model must produce one file:

```text
ai-factory-atom.html
```

The file uses pinned Three.js ES modules from a CDN and runs from a local static
HTTP server without a build step. It must not introduce a framework, package
manager, or additional source files.

“Standalone” means one authored HTML file with CDN dependencies. It does not
mean fully offline or free of external runtime dependencies.

## Visual Thesis

The page presents a cinematic “capability reactor” rather than a generic atom.
Raw metallic shards remain more chaotic around the outside, while the center is
dense, luminous, and structurally coherent. This visual transformation conveys
the movement from raw compute to useful capability.

The scene uses an asymmetrical split composition:

- The left side contains the message, explanatory copy, and a restrained data
  grid.
- The right side contains the interactive three-dimensional reactor.
- The reactor sits slightly above the vertical center and occupies roughly half
  of the desktop viewport height.

The visual language is near-black, ivory, cool lavender, and one tightly
controlled warm accent. Bloom, atmospheric dust, technical labels, and
vignettes are subordinate to the reactor. The prompt must explicitly prevent
decorative excess and illegible “AI sci-fi dashboard” clutter.

## Scene Construction

The reactor consists of:

- A dense core made from seeded, instanced crystalline shards.
- A center-weighted radial distribution rather than a uniform-volume
  distribution.
- Three thin, noisy orbital belts with different inclinations, angular speeds,
  and rotation directions.
- Two subtle elliptical guide lines.
- A restrained three-light setup that yields ivory highlights, a lavender rim,
  and a small warm reflection.
- Sparse environmental particles that can be removed by lower quality modes.

The bloom treatment is adaptive:

- Higher-capability devices use restrained post-processing bloom.
- Lower-capability devices use a cheaper glow treatment or disable bloom.
- Bloom must preserve visible shard detail and must not turn the core into a
  featureless white disk.

## Motion and Interaction

All WebGL animation uses elapsed seconds or frame delta, never raw
increments-per-frame. The same animation therefore runs at the same speed on
60 Hz, 120 Hz, and 144 Hz displays.

Motion is slow and continuous. It includes:

- A slow global rotation.
- Independently rotating orbital belts.
- Very slow core movement that shifts specular highlights.
- A restrained breathing glow.
- Damped pointer rotation and subtle pointer parallax.

Interactions include pointer drag on mouse and touch. Zoom is bounded and only
captures wheel input while the pointer is over the interactive canvas. The page
must retain ordinary scrolling behavior elsewhere.

The render loop pauses while the document is hidden. Reduced-motion mode keeps
the static composition and non-vestibular state cues while disabling continuous
rotation, parallax, pulsing, and animated zoom.

## Adaptive Quality

The implementation exposes three named quality profiles:

- `high`: desktop-class shard count, capped device-pixel ratio, restrained
  bloom, and sparse background particles.
- `balanced`: reduced shard count and bloom resolution while preserving the
  complete composition.
- `low`: mobile-safe shard count, lower pixel ratio, minimal glow, and no
  ambient dust.

Profile selection starts from viewport and device signals, then may step down
after a short rolling FPS measurement. It must not repeatedly oscillate between
profiles. The selected profile must be easy to override from a configuration
object near the top of the script.

All random scene generation uses an explicit seed so screenshots and reloads
remain reproducible.

## Responsive Behavior

The prompt specifies and requires verification at:

- 1440 × 900
- 1024 × 768
- 390 × 844

Desktop uses the split composition. On narrow screens, copy and canvas become a
controlled vertical composition. The reactor is repositioned and rescaled for
mobile rather than merely inheriting the desktop camera and world position.
Text must remain legible and must not collide with the reactor or viewport
edges.

## Resilience and Accessibility

The implementation includes:

- A readable fallback when WebGL initialization fails.
- A decorative canvas with appropriate accessibility treatment.
- Keyboard-visible focus for any real controls.
- A reduced-motion path.
- Pointer-capture cleanup, resize cleanup, and disposal of renderer, geometry,
  material, texture, composer, and event resources.
- A pinned CDN version and clear instructions for starting a local static
  server.

The displayed metrics must be labeled as illustrative unless the user supplies
real data.

## Verification Contract

The coding model must:

1. Implement the complete file rather than returning fragments or pseudocode.
2. Serve the page through a local static HTTP server.
3. Check the browser console and fix all runtime errors.
4. Inspect the three required viewport sizes.
5. Exercise drag, touch-equivalent pointer input, bounded zoom, resize,
   visibility pause, WebGL fallback, and reduced motion.
6. Confirm animation speed is delta-time based.
7. Confirm the scene remains visually readable in every quality profile.
8. Report the completed file, key implementation decisions, verification
   results, and any unavoidable limitation.

Performance targets are approximately 60 FPS on a typical current laptop and
at least 30 FPS on a typical current phone. These are targets, not unsupported
claims; the model must report the device or environment used for measurement.

## Prompt Structure

The final prompt will use this order:

1. Role and mission.
2. Required deliverable and non-negotiable constraints.
3. Visual thesis and anti-generic guardrails.
4. Detailed scene construction.
5. Motion and interaction requirements.
6. Adaptive-quality behavior.
7. Responsive and accessibility behavior.
8. Implementation-quality requirements.
9. Verification and acceptance checklist.
10. Required final response format.

The prompt will distinguish requirements from suggested starting values so the
implementation model may tune values when verification shows that the original
number harms composition or performance.
