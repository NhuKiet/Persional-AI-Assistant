# AI Factory Atom Fidelity Wave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the standalone Atom reactor match the supplied Opus 5 sequence with denser compact rings, a visibly hot core, deeper contrast, and an unmistakable center-to-rings travelling light wave.

**Architecture:** Preserve the current seeded Three.js `InstancedMesh` scene and shared beveled geometry. Add a compact additive heat sprite and retain the central point light as mutable scene state; split wave updates into a radial core signal and delayed angular ring bands using precomputed typed-array coordinates. Render the hot ring crest through atom-level sibling `InstancedMesh` overlays whose saved transforms are scale-gated, because per-instance vertex colours proved unreliable in the bloom post-processing path.

**Tech Stack:** Standalone HTML, Three.js 0.160.0 ES modules, UnrealBloomPass, PowerShell contract checks, Node.js syntax checking, local HTTP/browser visual verification, FFmpeg contact sheets.

## Global Constraints

- Modify the writable working copy at `C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\ai-factory-atom.html`.
- Update `C:\Users\longt\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\local-agent-mode-sessions\1a1e740c-d4a9-4ba0-afb8-912613387b04\e6d408fb-49e2-45aa-a9f8-fa9843d40c87\local_fef978ab-fbf7-4aed-84ae-533f52267181\outputs\ai-factory-atom.html` only after final verification.
- Keep one authored HTML file and pinned Three.js CDN imports.
- Preserve seeded layout, instancing, drag, parallax, bounded zoom, quality profiles, responsive layouts, WebGL fallback, and reduced motion.
- Use delta time, no per-frame object allocations, and no continuous instance-color uploads during the rest portion of the wave.
- Verify against the supplied 10 fps Opus 5 contact sheets and a new sequence of at least 30 browser frames.

---

### Task 1: Lock the Fidelity Regression Contract

**Files:**
- Modify: `C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\verify-ai-factory-atom.ps1`
- Test: `C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\verify-ai-factory-atom.ps1`

**Interfaces:**
- Consumes: Complete HTML source string in `$source`.
- Produces: Contract requirements for compact ring geometry, contrast, mutable heat source, angular ring coordinates, and rest-state upload suppression.

- [ ] **Step 1: Add failing geometry and lighting assertions**

Add these checks before the existing final failure block:

```powershell
Require-Match '\{ count:\s*760,\s*radius:\s*2\.80,\s*thickness:\s*0\.22' 'Inner ring must be dense and visually close to the core.'
Require-Match '\{ count:\s*880,\s*radius:\s*3\.35,\s*thickness:\s*0\.24' 'Middle ring must use the approved compact dense geometry.'
Require-Match '\{ count:\s*720,\s*radius:\s*3\.70,\s*thickness:\s*0\.21' 'Outer ring must stay inside the approved compact silhouette.'
Require-Match 'ringShardMin:\s*0\.05,\s*ringShardMax:\s*0\.13' 'Ring blocks must be thicker than the sparse previous build.'
Require-Match 'ambient:\s*\{\s*color:\s*0x5a5661,\s*intensity:\s*1\.1' 'Ambient fill must be low enough to preserve near-black shadow faces.'
Require-Match "g\.fillStyle\s*=\s*'#292627'" 'Environment base must not lift every shard into grey.'
Require-Match 'let corePoint,\s*heatSprite' 'Internal heat sources must remain mutable scene state.'
Require-Match 'function createHeatTexture\(\)' 'The core needs a compact white-hot texture separate from the broad halo.'
Forbid-Match 'rgba\(120,72,58,\.28\)' 'The previous warm background halo raises the black floor too much.'
```

- [ ] **Step 2: Add failing spatial-wave assertions**

```powershell
Require-Match 'function wrappedPhaseDistance\(a,\s*b\)' 'Ring wave requires a wrapped angular distance helper.'
Require-Match 'userData\.waveAngle\s*=' 'Every ring must retain a normalized angular coordinate per shard.'
Require-Match 'function updateCoreWave\(progress\)' 'Core heat must be updated separately from angular ring bands.'
Require-Match 'function updateRingWave\(mesh,\s*progress\)' 'Each orbital belt needs a travelling angular band.'
Require-Match 'waveNeedsReset' 'Instance colors must upload once on reset rather than throughout the rest window.'
Require-Match 'corePoint\.intensity\s*=' 'The internal point light must follow the core energy signal.'
Require-Match 'heatSprite\.material\.opacity\s*=' 'The compact hotspot must visibly ignite with the source.'
Forbid-Match 'Math\.sin\(a \* 3 \+ ringIndex \* 1\.7\) \* 0\.022' 'Tiny sinusoidal phase variation makes the whole ring brighten uniformly.'
```

- [ ] **Step 3: Run the contract and confirm the expected red state**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\verify-ai-factory-atom.ps1" -Path "C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\ai-factory-atom.html"
```

Expected: FAIL only on the newly added compact-geometry, heat-source, contrast, and angular-wave requirements.

---

### Task 2: Implement Compact Dense Rings and High-Contrast Heat Source

**Files:**
- Modify: `C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\ai-factory-atom.html`
- Test: `C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\verify-ai-factory-atom.ps1`

**Interfaces:**
- Consumes: Existing `CONFIG`, `createScene`, `createAtmosphere`, and `disposeWorld`.
- Produces: Mutable `corePoint`, compact `heatSprite`, denser compact rings, and a darker resting tonal floor.

- [ ] **Step 1: Apply approved geometry and tonal constants**

Use these values:

```js
background: 0x020203,
exposure: 1.14,
rings: [
  { count: 760, radius: 2.80, thickness: 0.22, rotX: 0.55, rotZ: 0.20, speed:  0.20 },
  { count: 880, radius: 3.35, thickness: 0.24, rotX:-0.90, rotZ:-0.40, speed: -0.28 },
  { count: 720, radius: 3.70, thickness: 0.21, rotX: 0.20, rotZ: 1.15, speed:  0.24 }
],
ringShardMin: 0.05, ringShardMax: 0.13,
lights: {
  key:  { color: 0xffffff, intensity: 4.8, pos: [6, 8, 10] },
  rim:  { color: 0x8a7bff, intensity: 2.0, pos: [-8, -4, 4] },
  warm: { color: 0xff9a70, intensity: 1.45, pos: [2, -6, -6] },
  ambient: { color: 0x5a5661, intensity: 1.1 },
  corePoint: { color: 0xfff4de, intensity: 1.25, distance: 8, decay: 1.35 }
}
```

Change the CSS warm halo to `rgba(120,72,58,.14)`, the generated environment fill to `#292627`, core material emissive intensity to `0.28`, ring material emissive intensity to `0.12`, and the broad glow opacity to `0.18` with bloom or `0.48` without bloom.

- [ ] **Step 2: Retain the point light and create the compact heat source**

Declare:

```js
let corePoint, heatSprite, glowSprite;
```

Assign the existing point light rather than shadowing it:

```js
const cp = L.corePoint;
corePoint = new THREE.PointLight(cp.color, cp.intensity, cp.distance, cp.decay);
corePoint.userData.baseIntensity = cp.intensity;
atom.add(corePoint);
```

Add:

```js
function createHeatTexture(){
  const cv = document.createElement('canvas');
  cv.width = cv.height = 192;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(96, 96, 0, 96, 96, 96);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.16, 'rgba(255,248,225,.92)');
  grd.addColorStop(0.42, 'rgba(220,214,255,.34)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 192, 192);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
```

In `createAtmosphere`, create the heat sprite before the broad halo:

```js
const heatOpacity = prefersReduced ? 0.34 : 0.16;
heatSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: createHeatTexture(),
  blending: THREE.AdditiveBlending,
  depthTest: false,
  depthWrite: false,
  transparent: true,
  opacity: heatOpacity
}));
heatSprite.scale.setScalar(1.75);
heatSprite.userData.baseOpacity = heatOpacity;
heatSprite.userData.baseScale = 1.75;
atom.add(heatSprite);
```

Dispose and clear `heatSprite` alongside `glowSprite`.

- [ ] **Step 3: Run the contract to isolate the remaining wave failures**

Expected: geometry, contrast, and heat-source checks pass; angular-wave checks still fail.

---

### Task 3: Replace Uniform Ring Brightening with Radial and Angular Travel

**Files:**
- Modify: `C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\ai-factory-atom.html`
- Test: `C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\verify-ai-factory-atom.ps1`

**Interfaces:**
- Consumes: `mesh.userData.baseColors`, core radial `wavePhase`, ring index, and ring speed.
- Produces: `wrappedPhaseDistance(a, b)`, `updateCoreWave(progress)`, `updateRingWave(mesh, progress)`, `resetCapabilityWave()`, and `updateCapabilityWave(dt)`.

- [ ] **Step 1: Replace wave constants**

```js
wave: {
  cycle: 3.4,
  travel: 2.5,
  coreWidth: 0.12,
  coreGain: 1.2,
  ringGain: 1.65,
  whiteLift: 0.24,
  coreEmissiveGain: 0.52,
  bloomGain: 0.42,
  pointGain: 4.6,
  heatOpacityGain: 0.68,
  ringEntry: [0.42, 0.52, 0.62],
  ringSweep: 0.36,
  ringBandWidth: 0.085
}
```

- [ ] **Step 2: Store angular coordinates instead of near-uniform phases**

Inside `createOrbitalRing` allocate `const waveAngle = new Float32Array(count)`.
For each shard:

```js
const normalizedAngle = ((a / (Math.PI * 2)) % 1 + 1) % 1;
waveAngle[i] = def.speed < 0 ? 1 - normalizedAngle : normalizedAngle;
```

After population:

```js
mesh.userData.waveAngle = waveAngle;
mesh.userData.ringIndex = ringIndex;
```

- [ ] **Step 3: Implement allocation-free wave helpers**

```js
function wrappedPhaseDistance(a, b){
  const d = Math.abs(a - b);
  return Math.min(d, 1 - d);
}

function writeWaveColor(colors, baseColors, index, signal, gain){
  const j = index * 3;
  const light = 1 + signal * gain;
  colors[j]     = baseColors[j]     * light + signal * CONFIG.wave.whiteLift;
  colors[j + 1] = baseColors[j + 1] * light + signal * CONFIG.wave.whiteLift;
  colors[j + 2] = baseColors[j + 2] * light + signal * CONFIG.wave.whiteLift;
}
```

`updateCoreWave(progress)` uses the existing radial phases and returns both
average shell energy and a source signal centered near progress `0.16`. It
updates core instance colors, core emissive intensity, point-light intensity,
heat-sprite opacity/scale, and the broad halo.

`updateRingWave(mesh, progress)` computes:

```js
const entry = CONFIG.wave.ringEntry[mesh.userData.ringIndex];
const head = (progress - entry) / CONFIG.wave.ringSweep;
```

When `head` is inside `0..1`, compute a smooth edge envelope, compare every
`waveAngle` with `head` using `wrappedPhaseDistance`, and write a Gaussian band
with `ringBandWidth`. Return the peak band signal without increasing the whole
ring's emissive intensity.

To keep the selected bright blocks visible on shadow-facing and occluded ring
segments, create a white additive `MeshBasicMaterial` overlay for every ring.
Attach each overlay directly to `atom`, copy the source ring rotation every
frame, preserve its instance matrices in `userData.baseMatrices`, and reveal
only the active angular crest by scaling the matching overlay instances from
zero to one. This retains individual block texture while avoiding a global
emissive flash or an unreliable instanced vertex-colour overlay.

- [ ] **Step 4: Suppress uploads during the rest interval**

Declare:

```js
let waveNeedsReset = false;
```

During the active `travel` window, set it true and run the core/ring updates.
When entering rest, call `resetCapabilityWave()` once, restore base arrays and
source properties, then set it false. Subsequent rest frames return without
touching instance colors.

- [ ] **Step 5: Run contract and syntax checks**

Run the PowerShell contract, extract the module script to
`ai-factory-atom-module.mjs`, then run:

```powershell
node --check "C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\ai-factory-atom-module.mjs"
```

Expected: contract PASS and Node exit code `0`.

---

### Task 4: Browser Sequence Verification and Delivery

**Files:**
- Verify: `C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\ai-factory-atom.html`
- Create: `C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\final-fidelity-sequence\final-001.jpg` through `final-030.jpg`
- Create: `C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\final-fidelity-sequence\final-sheet-0.jpg` through `final-sheet-2.jpg`
- Modify: `C:\Users\longt\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\local-agent-mode-sessions\1a1e740c-d4a9-4ba0-afb8-912613387b04\e6d408fb-49e2-45aa-a9f8-fa9843d40c87\local_fef978ab-fbf7-4aed-84ae-533f52267181\outputs\ai-factory-atom.html`
- Create: `C:\Users\longt\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\local-agent-mode-sessions\1a1e740c-d4a9-4ba0-afb8-912613387b04\e6d408fb-49e2-45aa-a9f8-fa9843d40c87\local_fef978ab-fbf7-4aed-84ae-533f52267181\outputs\pre-fidelity-wave.html`

**Interfaces:**
- Consumes: Complete working HTML and Opus reference contact sheets.
- Produces: Verified target HTML, recovery copy, and final comparison sequence.

- [ ] **Step 1: Render the high-quality profile**

Serve the writable visualization directory over localhost. Open
`ai-factory-atom.html?quality=high`, wait until the canvas has class `ready`,
and confirm `document.body` does not contain `webgl-failed`.

- [ ] **Step 2: Capture and inspect one complete cycle**

Capture at least 30 consecutive screenshots at approximately 10 fps. Build
three 5×2 contact sheets with FFmpeg. Compare them with
`opus-second-0.jpg` through `opus-second-3.jpg`.

Reject the build if the contact sheets do not show:

- A white-hot core phase.
- A clear bright shell crossing the core.
- Delayed activation of inner, middle, then outer ring.
- A bright segment changing angular position on at least one ring.
- Resting ring faces near black between bright bands.

- [ ] **Step 3: Verify runtime and responsive behavior**

Confirm browser logs are empty, drag and wheel zoom still respond, and the
canvas remains ready at desktop and mobile layout checkpoints. Confirm the
reduced-motion branch does not call `updateCapabilityWave(dt)` and keeps a
static hotspot.

- [ ] **Step 4: Deliver with recovery**

Copy the current target to `pre-fidelity-wave.html`, copy the verified working
HTML to the target, confirm source and target SHA-256 hashes match, then rerun
the contract, Node syntax check, HTTP 200 check, and browser error check against
the target path.
