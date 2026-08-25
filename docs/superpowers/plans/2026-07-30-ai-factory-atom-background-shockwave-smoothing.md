# AI Factory Atom Background and Shockwave Smoothing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brighten the Atom scene's negative space and replace the delayed full-ring flashes with a continuous radial shockwave that overlaps cleanly from the core through all three rings.

**Architecture:** Preserve the user's current four-slot shockwave and instanced overlay architecture. Shorten the loop, widen the asymmetric front, and distribute each ring's phases across its physical thickness so the inner edge ignites before the outer edge; retain a static reduced-motion branch and the existing quality profiles.

**Tech Stack:** Standalone HTML, CSS, Three.js 0.160.0 ES modules, `InstancedMesh`, UnrealBloomPass, PowerShell regression contracts, Node.js syntax checking, in-app browser visual verification, FFmpeg contact sheets.

## Global Constraints

- Treat the user's current target HTML as the source of truth:
  `C:\Users\longt\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\local-agent-mode-sessions\1a1e740c-d4a9-4ba0-afb8-912613387b04\e6d408fb-49e2-45aa-a9f8-fa9843d40c87\local_fef978ab-fbf7-4aed-84ae-533f52267181\outputs\ai-factory-atom.html`.
- Make all edits through the writable working file:
  `C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\ai-factory-atom-smoothing.html`.
- Back up the target as `pre-background-smoothing.html` immediately before delivery.
- Preserve the user's copper/amber lighting, core overlay architecture, seeded layout, quality downgrade, drag, parallax, zoom, responsive layout, WebGL fallback, and reduced-motion behavior.
- Use `cycle: 4.8`, `bandSlots: [0, 0.25, 0.5, 0.75]`, `coreSpread: 0.15`, `ringPhaseSpread: 0.055`, `tail: 0.17`, `coreWidth: 0.065`, and `ringBandWidth: 0.065`.
- Use CSS background `#080706`, Three.js background `0x080706`, and warm atmospheric alpha `0.22`.
- Use core overlay opacity `0.18`, ring overlay opacity `0.48`, core overlay range `[0.60, 0.92]`, ring overlay range `[0.20, 0.72]`, core energy scale `5.0`, heat-sprite scale `2.1`, and broad-glow opacity `0.24` with bloom or `0.52` without bloom.
- Do not allocate matrices, colours, or vectors inside the animation loop.
- The standalone artifact is outside the Git repository; use recovery copies and SHA-256 verification instead of implementation commits.

---

### Task 1: Create the Focused Smoothing Regression Contract

**Files:**
- Create: `C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\verify-ai-factory-atom-smoothing.ps1`
- Test: `C:\Users\longt\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\local-agent-mode-sessions\1a1e740c-d4a9-4ba0-afb8-912613387b04\e6d408fb-49e2-45aa-a9f8-fa9843d40c87\local_fef978ab-fbf7-4aed-84ae-533f52267181\outputs\ai-factory-atom.html`

**Interfaces:**
- Consumes: A `-Path` argument pointing to a complete Atom HTML source file.
- Produces: Exit code `0` and a single `PASS` line when all approved smoothing requirements are present; otherwise one error per missing requirement and exit code `1`.

- [ ] **Step 1: Write the failing contract**

Create the script with these checks:

```powershell
param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

$source = Get-Content -Raw -Encoding utf8 -LiteralPath $Path
$failures = [System.Collections.Generic.List[string]]::new()

function Require-Match {
  param([string]$Pattern, [string]$Message)
  if ($source -notmatch $Pattern) { $failures.Add($Message) }
}

function Forbid-Match {
  param([string]$Pattern, [string]$Message)
  if ($source -match $Pattern) { $failures.Add($Message) }
}

Require-Match '--bg:#080706' 'CSS background must use the approved brighter cinematic black.'
Require-Match 'rgba\(120,72,58,\.22\)' 'Warm background atmosphere must use alpha 0.22.'
Require-Match 'background:\s*0x080706' 'Three.js fog and background must match the CSS field.'
Require-Match 'cycle:\s*4\.8' 'Shockwave cycle must reduce peak-to-peak delay to 1.2 seconds.'
Require-Match 'bandSlots:\s*\[0,\s*0\.25,\s*0\.5,\s*0\.75\]' 'Four shockwave slots must remain evenly ordered.'
Require-Match 'coreSpread:\s*0\.15' 'Core phase spread must use the approved compact interval.'
Require-Match 'ringPhaseSpread:\s*0\.055' 'Ring phases must spread through each belt thickness.'
Require-Match 'tail:\s*0\.17' 'Afterglow must overlap consecutive slots.'
Require-Match 'coreWidth:\s*0\.065' 'Core leading shoulder must use the approved overlap width.'
Require-Match 'ringBandWidth:\s*0\.065' 'Ring leading shoulder must use the approved overlap width.'
Require-Match 'coreEnergyScale:\s*5\.0' 'Core amplification must retain texture at peak energy.'
Require-Match 'coreOverlayRange:\s*\[0\.60,\s*0\.92\]' 'Core overlay must select only the narrow hot crest.'
Require-Match 'ringOverlayRange:\s*\[0\.20,\s*0\.72\]' 'Ring overlay must retain block texture through its hand-off.'
Require-Match 'function wrapPhase\(value\)' 'Phase assignments need an explicit loop-safe wrapper.'
Require-Match 'const radialPhase\s*=\s*\(rr\s*-\s*def\.radius\)\s*/\s*\(def\.thickness\s*\*\s*2\)' 'Ring timing must derive from physical belt depth.'
Require-Match 'waveAngle\[i\]\s*=\s*wrapPhase\([\s\S]{0,180}?radialPhase\s*\*\s*CONFIG\.wave\.ringPhaseSpread' 'Inner and outer ring edges must receive different phases.'
Require-Match 'createWaveOverlay\(mesh,\s*geo,\s*count,\s*0\.18\)' 'Core additive overlay must avoid white clipping.'
Require-Match 'function createWaveOverlay\(mesh,\s*geometry,\s*count,\s*opacity\s*=\s*0\.48\)' 'Ring overlays must keep individual block boundaries.'
Require-Match 'heatSprite\.scale\.setScalar\(2\.1\)' 'Heat source must remain compact enough to show the core shell.'
Require-Match 'const opacity\s*=\s*profile\.bloom\s*\?\s*0\.24\s*:\s*0\.52' 'Broad glow must stay subordinate to shard texture.'
Require-Match 'if\s*\(!prefersReduced\)\s*\{[\s\S]{0,900}?updateCapabilityWave\(dt\)' 'Travelling updates must remain disabled under reduced motion.'
Forbid-Match 'Math\.sin\(a\s*\*\s*3\s*\+\s*ringIndex\s*\*\s*1\.7\)\s*\*\s*0\.006' 'A near-uniform angular jitter makes a whole ring switch at once.'

if ($failures.Count -gt 0) {
  foreach ($failure in $failures) { Write-Error $failure }
  exit 1
}

Write-Output 'PASS: Atom background and radial-shockwave smoothing contract'
```

- [ ] **Step 2: Run the contract against the user's current file**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\verify-ai-factory-atom-smoothing.ps1" -Path "C:\Users\longt\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\local-agent-mode-sessions\1a1e740c-d4a9-4ba0-afb8-912613387b04\e6d408fb-49e2-45aa-a9f8-fa9843d40c87\local_fef978ab-fbf7-4aed-84ae-533f52267181\outputs\ai-factory-atom.html"
```

Expected: FAIL on the brighter background, `4.8s` timing, radial ring phase, overlap, and non-clipping energy requirements.

---

### Task 2: Implement the Brighter Field and Continuous Radial Hand-Off

**Files:**
- Create from target: `C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\ai-factory-atom-smoothing.html`
- Modify: `C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\ai-factory-atom-smoothing.html`
- Test: `C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\verify-ai-factory-atom-smoothing.ps1`

**Interfaces:**
- Consumes: The user's current four-slot `frontSignal`, `createCore`, `createOrbitalRing`, `createWaveOverlay`, `updateCoreWave`, and reduced-motion branch.
- Produces: `wrapPhase(value): number`, radially distributed `mesh.userData.waveAngle`, brighter matched CSS/WebGL backgrounds, and the approved overlap/energy constants.

- [ ] **Step 1: Copy the user's current file into the writable workspace**

Run:

```powershell
Copy-Item -LiteralPath "C:\Users\longt\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\local-agent-mode-sessions\1a1e740c-d4a9-4ba0-afb8-912613387b04\e6d408fb-49e2-45aa-a9f8-fa9843d40c87\local_fef978ab-fbf7-4aed-84ae-533f52267181\outputs\ai-factory-atom.html" -Destination "C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\ai-factory-atom-smoothing.html"
```

Verify both SHA-256 hashes match before editing.

- [ ] **Step 2: Apply the approved background and shockwave constants**

Change the CSS and `CONFIG` values to:

```css
:root{
  --bg:#080706;
}

.vignette{
  background:
    radial-gradient(58% 52% at 64% 48%, rgba(120,72,58,.22), transparent 62%),
    radial-gradient(125% 125% at 50% 50%, transparent 54%, rgba(0,0,0,.9));
}
```

```js
background: 0x080706,

wave: {
  cycle: 4.8,
  bandSlots: [0, 0.25, 0.5, 0.75],
  coreSpread: 0.15,
  ringPhaseSpread: 0.055,
  fronts: 1,
  tail: 0.17,
  coreWidth: 0.065,
  ringBandWidth: 0.065,
  coreGain: 0.85,
  ringGain: 1.9,
  whiteLift: 0.1,
  ringWhiteLift: 0.62,
  coreEnergyScale: 5.0,
  coreEmissiveGain: 0.34,
  bloomGain: 0.32,
  pointGain: 2.2,
  heatOpacityGain: 0.34,
  coreOverlayRange: [0.60, 0.92],
  ringOverlayRange: [0.20, 0.72]
}
```

- [ ] **Step 3: Replace the near-uniform ring phase with radial belt depth**

Add the loop-safe helper before `frontSignal`:

```js
function wrapPhase(value){
  return ((value % 1) + 1) % 1;
}
```

In `createCore`, assign:

```js
wavePhase[i] = wrapPhase(
  CONFIG.wave.bandSlots[0]
  + (r / c.radius) * CONFIG.wave.coreSpread
  + range(rnd, -0.004, 0.004)
);
```

In `createOrbitalRing`, replace the sinusoidal slot jitter with:

```js
const slot = CONFIG.wave.bandSlots[ringIndex + 1];
const radialPhase = (rr - def.radius) / (def.thickness * 2);
waveAngle[i] = wrapPhase(
  slot
  + radialPhase * CONFIG.wave.ringPhaseSpread
  + range(rnd, -0.003, 0.003)
);
```

The equation intentionally does not use angle `a`: the effect remains a radial shockwave, not an angular chase.

- [ ] **Step 4: Apply the non-clipping overlay and atmosphere values**

Change the core overlay call and default ring overlay opacity:

```js
createWaveOverlay(mesh, geo, count, 0.18);

function createWaveOverlay(mesh, geometry, count, opacity = 0.48){
```

Change the heat sprite and broad glow:

```js
heatSprite.scale.setScalar(2.1);
heatSprite.userData.baseScale = 2.1;

const opacity = profile.bloom ? 0.24 : 0.52;
```

- [ ] **Step 5: Run the focused contract**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\verify-ai-factory-atom-smoothing.ps1" -Path "C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\ai-factory-atom-smoothing.html"
```

Expected: `PASS: Atom background and radial-shockwave smoothing contract`.

- [ ] **Step 6: Check the inline ES module syntax**

Run:

```powershell
$html = Get-Content -Raw -Encoding utf8 -LiteralPath "C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\ai-factory-atom-smoothing.html"
$module = [regex]::Match($html, '<script type="module">\s*(?<js>[\s\S]*?)</script>')
if (-not $module.Success) { throw 'Module script not found.' }
$module.Groups['js'].Value | node --input-type=module --check -
```

Expected: Node exit code `0` with no syntax errors.

---

### Task 3: Verify the Full Cycle and Deliver with Recovery

**Files:**
- Verify: `C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\ai-factory-atom-smoothing.html`
- Create: `C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\shockwave-smoothing-final\frame-001.jpg` through `frame-048.jpg`
- Create: `C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\shockwave-smoothing-final\contact-sheet.jpg`
- Create: `C:\Users\longt\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\local-agent-mode-sessions\1a1e740c-d4a9-4ba0-afb8-912613387b04\e6d408fb-49e2-45aa-a9f8-fa9843d40c87\local_fef978ab-fbf7-4aed-84ae-533f52267181\outputs\pre-background-smoothing.html`
- Modify: `C:\Users\longt\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\local-agent-mode-sessions\1a1e740c-d4a9-4ba0-afb8-912613387b04\e6d408fb-49e2-45aa-a9f8-fa9843d40c87\local_fef978ab-fbf7-4aed-84ae-533f52267181\outputs\ai-factory-atom.html`

**Interfaces:**
- Consumes: A contract-green and syntax-valid smoothing HTML.
- Produces: A visually verified target file, recovery copy, matching SHA-256 hashes, 48-frame evidence, and a clean browser runtime.

- [ ] **Step 1: Serve and inspect the working artifact**

Serve the visualization directory over localhost and open:

```text
http://127.0.0.1:8765/ai-factory-atom-smoothing.html?quality=high&debugWave=1
```

Confirm:

```js
({
  ready: document.querySelector('#scene-canvas').classList.contains('ready'),
  webglFailed: document.body.classList.contains('webgl-failed'),
  fallback: getComputedStyle(document.querySelector('#fallback')).display
})
```

Expected: `{ ready: true, webglFailed: false, fallback: "none" }`.

- [ ] **Step 2: Capture one complete cycle**

Capture 48 consecutive JPEG frames at approximately 10 fps. Save them as
`frame-001.jpg` through `frame-048.jpg`, then create the contact sheet:

```powershell
& "C:\Users\longt\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.2-full_build\bin\ffmpeg.exe" `
  -hide_banner -loglevel error -y -framerate 10 `
  -i "C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\shockwave-smoothing-final\frame-%03d.jpg" `
  -vf "scale=230:-1,tile=8x6:padding=4:margin=4:color=black" `
  -frames:v 1 `
  "C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\shockwave-smoothing-final\contact-sheet.jpg"
```

Reject the build if any consecutive frame pair shows a full ring appearing
without a visible radial-thickness transition, if the hand-off goes fully dark,
or if the core/ring becomes a flat white silhouette.

- [ ] **Step 3: Check the exact phase hand-offs**

With `debugWave=1`, capture states when the leading front crosses:

```js
[0.00, 0.125, 0.25, 0.375, 0.50, 0.625, 0.75, 0.875]
```

Confirm the energy sequence is core, overlap, inner ring, overlap, middle ring,
overlap, outer ring, overlap. At the four midpoint phases, at least one outgoing
or incoming band must retain visible material energy.

- [ ] **Step 4: Verify interactions and runtime**

Use a real pointer drag across the canvas and a wheel zoom. After both actions,
confirm the canvas remains ready, `webgl-failed` remains absent, fallback stays
hidden, and browser logs are empty.

- [ ] **Step 5: Back up and replace the target**

Resolve and verify the exact target directory, then run:

```powershell
Copy-Item -LiteralPath "C:\Users\longt\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\local-agent-mode-sessions\1a1e740c-d4a9-4ba0-afb8-912613387b04\e6d408fb-49e2-45aa-a9f8-fa9843d40c87\local_fef978ab-fbf7-4aed-84ae-533f52267181\outputs\ai-factory-atom.html" -Destination "C:\Users\longt\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\local-agent-mode-sessions\1a1e740c-d4a9-4ba0-afb8-912613387b04\e6d408fb-49e2-45aa-a9f8-fa9843d40c87\local_fef978ab-fbf7-4aed-84ae-533f52267181\outputs\pre-background-smoothing.html"
Copy-Item -LiteralPath "C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\ai-factory-atom-smoothing.html" -Destination "C:\Users\longt\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\local-agent-mode-sessions\1a1e740c-d4a9-4ba0-afb8-912613387b04\e6d408fb-49e2-45aa-a9f8-fa9843d40c87\local_fef978ab-fbf7-4aed-84ae-533f52267181\outputs\ai-factory-atom.html" -Force
```

- [ ] **Step 6: Verify the delivered target**

Run the focused contract and syntax check against the target. Confirm:

```powershell
$workingHash = (Get-FileHash -Algorithm SHA256 -LiteralPath "C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\ai-factory-atom-smoothing.html").Hash
$targetHash = (Get-FileHash -Algorithm SHA256 -LiteralPath "C:\Users\longt\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\local-agent-mode-sessions\1a1e740c-d4a9-4ba0-afb8-912613387b04\e6d408fb-49e2-45aa-a9f8-fa9843d40c87\local_fef978ab-fbf7-4aed-84ae-533f52267181\outputs\ai-factory-atom.html").Hash
if ($workingHash -ne $targetHash) { throw 'Delivered target differs from verified working source.' }
```

Open the delivered target with a cache-busting query and confirm the ready
canvas, hidden fallback, no WebGL failure, and empty browser logs one final time.

