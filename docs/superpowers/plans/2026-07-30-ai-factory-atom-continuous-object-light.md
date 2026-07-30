# AI Factory Atom Continuous Object-Only Light Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the perceived pauses between rings 1–2 and 2–3 by deriving every existing block's wave phase from one monotonic radial field, while keeping empty space dark and brightening the cinematic background.

**Architecture:** The standalone HTML remains a single Three.js artifact. A construction-time radial transfer maps core and ring shard radii into one ordered phase domain; the existing asymmetric object signal and additive instance overlays consume those phases. A damped scalar follows object energy for bloom, while a focused PowerShell contract and browser captures verify that no travelling gap-light layer is introduced.

**Tech Stack:** HTML/CSS, JavaScript ES modules, Three.js `0.164.1`, PowerShell contract checks, Node syntax checking, in-app browser runtime verification, FFmpeg contact sheets.

## Global Constraints

- Only existing core and ring blocks may become brighter; empty space between rings must remain empty and dark.
- Do not add a visible shockwave sphere, shell, disc, line, sprite, particle layer, geometry, or travelling light in the gaps.
- Preserve seeded shard placement, ring geometry, camera composition, interactions, rotation speeds, responsive layout, fallback behavior, dark bevels, and material variation.
- CSS base background and Three.js scene/fog background must be `#110d0b` / `0x110d0b`.
- Radial phase ordering must be monotonic by physical shard radius; fixed `bandSlots` must not participate in travelling-wave timing.
- At each ring 1→2 and ring 2→3 hand-off, outgoing or incoming normalized object energy must remain at least `0.20`.
- Bloom damping must be FPS-independent and sourced only from current object energy.
- `prefers-reduced-motion` keeps a static object-energy state and does not advance the travelling front or bloom damping.
- Do not introduce per-frame matrix, color, vector, array, or geometry allocations.
- Back up the target with long-path-safe APIs and verify the backup SHA-256 before replacement.

---

### Task 1: Add a Failing Continuous Object-Light Contract

**Files:**
- Create: `C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\verify-ai-factory-atom-continuous-object-light.ps1`
- Verify: `C:\Users\longt\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\local-agent-mode-sessions\1a1e740c-d4a9-4ba0-afb8-912613387b04\e6d408fb-49e2-45aa-a9f8-fa9843d40c87\local_fef978ab-fbf7-4aed-84ae-533f52267181\outputs\ai-factory-atom.html`

**Interfaces:**
- Consumes: `-Path <html>` pointing at one standalone Atom artifact.
- Produces: exit `0` plus `PASS: continuous object-only Atom light contract`, or exit `1` with one error per violated invariant.

- [ ] **Step 1: Write the focused contract**

Create the script with this structure:

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

Require-Match '--bg:#110d0b' 'CSS background must use the approved brighter field.'
Require-Match 'background:\s*0x110d0b' 'Three.js scene and fog must match the CSS field.'
Require-Match 'rgba\(120,72,58,\.28\)' 'Warm centre atmosphere must use alpha 0.28.'
Require-Match 'radialAnchors:\s*\[[\s\S]{0,900}?\[3\.91,\s*0\.62\]' 'The approved monotonic physical-radius anchors are required.'
Require-Match 'function radialPhaseFromRadius\(radius\)' 'A shared physical-radius transfer is required.'
Require-Match 'wavePhase\[i\]\s*=\s*radialPhaseFromRadius\(r\)' 'Core timing must use physical radius.'
Require-Match 'waveAngle\[i\]\s*=\s*radialPhaseFromRadius\(rr\)' 'Ring timing must use physical radius.'
Require-Match 'let smoothedWaveEnergy\s*=\s*0' 'Bloom needs persistent damped object energy.'
Require-Match '1\s*-\s*Math\.exp\(-CONFIG\.wave\.bloomDamping\s*\*\s*dt\)' 'Bloom damping must be FPS-independent.'
Require-Match 'smoothedWaveEnergy\s*\+=\s*\(peakEnergy\s*-\s*smoothedWaveEnergy\)' 'Bloom must follow object energy without a dominant-band step.'
Require-Match 'const prefersReduced\s*=\s*matchMedia\(' 'The native reduced-motion preference must remain authoritative.'
Require-Match 'reducedMotion' 'A browser-verifiable reduced-motion query override is required.'
Require-Match 'if\s*\(!prefersReduced\)\s*\{[\s\S]{0,900}?updateCapabilityWave\(dt\)' 'Travelling updates must remain reduced-motion guarded.'

Forbid-Match 'bandSlots\s*:' 'Fixed band slots cause the outer-ring pauses.'
Forbid-Match 'new\s+THREE\.(SphereGeometry|RingGeometry|CircleGeometry)\b' 'No travelling shell or disc may fill empty space.'
Forbid-Match '(gapGlow|shockwaveMesh|waveShell|travellingLight)' 'No gap-light helper may be introduced.'

$anchors = @(
  [pscustomobject]@{ Radius = 0.00; Phase = 0.00 },
  [pscustomobject]@{ Radius = 1.95; Phase = 0.15 },
  [pscustomobject]@{ Radius = 2.58; Phase = 0.20 },
  [pscustomobject]@{ Radius = 3.02; Phase = 0.32 },
  [pscustomobject]@{ Radius = 3.11; Phase = 0.34 },
  [pscustomobject]@{ Radius = 3.59; Phase = 0.49 },
  [pscustomobject]@{ Radius = 3.91; Phase = 0.62 }
)
for ($i = 1; $i -lt $anchors.Count; $i++) {
  if ($anchors[$i].Radius -le $anchors[$i - 1].Radius -or
      $anchors[$i].Phase -le $anchors[$i - 1].Phase) {
    $failures.Add('Radial anchors must be strictly monotonic.')
    break
  }
}

$tail = 0.17
$shoulder = 0.065
foreach ($handoff in @(@(0.26, 0.415), @(0.415, 0.535))) {
  $mid = ($handoff[0] + $handoff[1]) / 2
  $outgoing = [Math]::Exp(-($mid - $handoff[0]) / $tail)
  $ahead = ($handoff[1] - $mid) / $shoulder
  $incoming = [Math]::Exp(-0.5 * $ahead * $ahead)
  if ([Math]::Max($outgoing, $incoming) -lt 0.20) {
    $failures.Add('Outer-ring hand-off energy must remain at least 0.20.')
  }
}

if ($failures.Count -gt 0) {
  foreach ($failure in $failures) { Write-Error $failure }
  exit 1
}

Write-Output 'PASS: continuous object-only Atom light contract'
```

- [ ] **Step 2: Run the contract against the current target and verify RED**

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  "C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\verify-ai-factory-atom-continuous-object-light.ps1" `
  -Path "C:\Users\longt\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\local-agent-mode-sessions\1a1e740c-d4a9-4ba0-afb8-912613387b04\e6d408fb-49e2-45aa-a9f8-fa9843d40c87\local_fef978ab-fbf7-4aed-84ae-533f52267181\outputs\ai-factory-atom.html"
```

Expected: exit `1`. Failures must include the old `#080706` background, the
presence of `bandSlots`, and the absence of `radialPhaseFromRadius` and
`smoothedWaveEnergy`.

- [ ] **Step 3: Save the RED evidence**

Record the exact exit code and failure list in:

```text
C:\Users\longt\Music\KietAI\Persional-AI-Assistant\.superpowers\sdd\continuous-object-light-task-1-report.md
```

No production or target file changes are allowed in Task 1.

---

### Task 2: Implement the Monotonic Object-Only Radial Field

**Files:**
- Create: `C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\ai-factory-atom-continuous-object-light.html`
- Modify: `C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\ai-factory-atom-continuous-object-light.html`
- Test: `C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\verify-ai-factory-atom-continuous-object-light.ps1`

**Interfaces:**
- Consumes: the current delivered target and the RED contract from Task 1.
- Produces: a contract-green, syntax-valid trial artifact. `radialPhaseFromRadius(radius: number): number` returns a monotonic phase in `[0, 0.62]`.

- [ ] **Step 1: Create the isolated trial copy**

Resolve the target path and copy it mechanically:

```powershell
$source = "C:\Users\longt\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\local-agent-mode-sessions\1a1e740c-d4a9-4ba0-afb8-912613387b04\e6d408fb-49e2-45aa-a9f8-fa9843d40c87\local_fef978ab-fbf7-4aed-84ae-533f52267181\outputs\ai-factory-atom.html"
$trial = "C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\ai-factory-atom-continuous-object-light.html"
Copy-Item -LiteralPath $source -Destination $trial
```

Confirm the source and trial SHA-256 hashes are initially identical.

- [ ] **Step 2: Apply the brighter background**

Use `apply_patch` to make only these replacements:

```css
:root{--bg:#110d0b;--fg:#dedde8;--muted:#83818f;--line:rgba(255,255,255,.12)}
```

```css
radial-gradient(ellipse at 63% 47%,rgba(120,72,58,.28),transparent 48%)
```

```js
background: 0x110d0b,
```

Do not change shard colors, exposure, directional lights, or material
roughness/metalness.

- [ ] **Step 3: Replace fixed slots with radial anchors**

Inside `CONFIG.wave`, remove `bandSlots` and add:

```js
radialAnchors: [
  [0.00, 0.00],
  [1.95, 0.15],
  [2.58, 0.20],
  [3.02, 0.32],
  [3.11, 0.34],
  [3.59, 0.49],
  [3.91, 0.62]
],
bloomDamping: 7.5,
```

Keep `cycle: 4.8`, `tail: 0.17`, `coreWidth: 0.065`, and
`ringBandWidth: 0.065`.

- [ ] **Step 4: Add the monotonic construction-time transfer**

Immediately after `wrapPhase`, add:

```js
function radialPhaseFromRadius(radius){
  const anchors = CONFIG.wave.radialAnchors;
  if (radius <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++){
    const [r1, p1] = anchors[i];
    if (radius <= r1){
      const [r0, p0] = anchors[i - 1];
      const t = (radius - r0) / (r1 - r0);
      return p0 + (p1 - p0) * t;
    }
  }
  return anchors[anchors.length - 1][1];
}
```

Replace the core phase assignment with:

```js
wavePhase[i] = radialPhaseFromRadius(r);
```

Replace the ring phase assignment with:

```js
waveAngle[i] = radialPhaseFromRadius(rr);
```

Delete the old slot, `radialPhase`, and random phase-jitter expressions. This
preserves strict radial ordering and introduces no per-frame allocations.

- [ ] **Step 5: Smooth bloom from object energy**

Near `waveTime`, add:

```js
let smoothedWaveEnergy = 0;
```

In `resetCapabilityWave`, set:

```js
smoothedWaveEnergy = 0;
```

Replace the direct bloom assignment inside `updateCapabilityWave(dt)` with:

```js
const bloomEase = 1 - Math.exp(-CONFIG.wave.bloomDamping * dt);
smoothedWaveEnergy += (peakEnergy - smoothedWaveEnergy) * bloomEase;
if (bloomPass){
  bloomPass.strength = CONFIG.bloom.strength
    * (1 + smoothedWaveEnergy * wave.bloomGain);
}
```

The target remains the maximum energy of existing core/ring blocks. Do not add
another bloom source or animate a gap object.

- [ ] **Step 6: Add a browser-verifiable reduced-motion override**

Create one shared query object before the preference constant:

```js
const query = new URLSearchParams(location.search);
const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  || query.has('reducedMotion');
const debugWave = query.has('debugWave');
const debugOverlay = query.has('debugOverlay');
```

Remove the three separate `new URLSearchParams(location.search)` calls. This
does not alter normal users' OS preference; it only permits deterministic
runtime verification.

- [ ] **Step 7: Run the focused contract and verify GREEN**

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  "C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\verify-ai-factory-atom-continuous-object-light.ps1" `
  -Path "C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\ai-factory-atom-continuous-object-light.html"
```

Expected:

```text
PASS: continuous object-only Atom light contract
```

- [ ] **Step 8: Check the inline ES module syntax**

Extract the contents of `<script type="module">...</script>` in memory and pipe
it to:

```powershell
node --input-type=module --check
```

Expected: exit `0` with no syntax output.

---

### Task 3: Verify Visual Continuity, Reduced Motion, and Delivery

**Files:**
- Verify: `C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\ai-factory-atom-continuous-object-light.html`
- Create: `C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\continuous-object-light-final\frame-001.jpg` through `frame-048.jpg`
- Create: `C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\continuous-object-light-final\contact-sheet.jpg`
- Create: `C:\Users\longt\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\local-agent-mode-sessions\1a1e740c-d4a9-4ba0-afb8-912613387b04\e6d408fb-49e2-45aa-a9f8-fa9843d40c87\local_fef978ab-fbf7-4aed-84ae-533f52267181\outputs\pre-continuous-object-light.html`
- Modify: `C:\Users\longt\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\local-agent-mode-sessions\1a1e740c-d4a9-4ba0-afb8-912613387b04\e6d408fb-49e2-45aa-a9f8-fa9843d40c87\local_fef978ab-fbf7-4aed-84ae-533f52267181\outputs\ai-factory-atom.html`

**Interfaces:**
- Consumes: the contract-green trial artifact from Task 2.
- Produces: a visually verified target, a byte-exact pre-delivery backup, 48-frame evidence, and matching trial/target/HTTP SHA-256 hashes.

- [ ] **Step 1: Serve and inspect the trial**

Serve the visualization directory on `127.0.0.1:8765` and open:

```text
http://127.0.0.1:8765/ai-factory-atom-continuous-object-light.html?quality=high&debugWave=1
```

Confirm:

```js
({
  background: getComputedStyle(document.body).backgroundColor,
  ready: document.querySelector('#scene-canvas').classList.contains('ready'),
  webglFailed: document.body.classList.contains('webgl-failed'),
  fallback: getComputedStyle(document.querySelector('#fallback')).display
})
```

Expected: background `rgb(17, 13, 11)`, ready `true`, WebGL failure `false`,
fallback `"none"`, and zero browser logs.

- [ ] **Step 2: Capture and inspect one complete cycle**

Capture 48 consecutive JPEG frames at approximately 10 fps. Create an 8×6
contact sheet:

```powershell
& "C:\Users\longt\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.2-full_build\bin\ffmpeg.exe" `
  -hide_banner -loglevel error -y -framerate 10 `
  -i "C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\continuous-object-light-final\frame-%03d.jpg" `
  -vf "scale=230:-1,tile=8x6:padding=4:margin=4:color=black" `
  -frames:v 1 `
  "C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\continuous-object-light-final\contact-sheet.jpg"
```

Reject the trial if ring 1→2 or ring 2→3 contains a fully dark hand-off, a
one-frame brightness step, a luminous bridge in empty space, or flat white
block silhouettes.

- [ ] **Step 3: Check exact outer-ring hand-offs**

Using `canvas.dataset.waveFronts` and `canvas.dataset.ringEnergy`, capture
samples while the front crosses ring centres near phases `0.26`, `0.415`, and
`0.535`, plus both midpoints.

At each midpoint, assert:

```js
Math.max(outgoingRingEnergy, incomingRingEnergy) >= 0.20
```

Visually confirm that energy exists only on ring blocks and not between them.

- [ ] **Step 4: Verify reduced motion and interactions**

Open:

```text
http://127.0.0.1:8765/ai-factory-atom-continuous-object-light.html?quality=high&debugWave=1&reducedMotion=1
```

Sample `canvas.dataset.waveFronts` twice at least one second apart. Both values
must be absent or identical. Confirm canvas ready, fallback hidden, and zero
browser logs.

Return to normal motion, perform a real pointer drag and wheel zoom, then
confirm the healthy runtime state remains unchanged.

- [ ] **Step 5: Create and verify the recovery backup before replacement**

Use a long-path prefix and terminating .NET file APIs:

```powershell
$target = "C:\Users\longt\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\local-agent-mode-sessions\1a1e740c-d4a9-4ba0-afb8-912613387b04\e6d408fb-49e2-45aa-a9f8-fa9843d40c87\local_fef978ab-fbf7-4aed-84ae-533f52267181\outputs\ai-factory-atom.html"
$backup = "C:\Users\longt\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\local-agent-mode-sessions\1a1e740c-d4a9-4ba0-afb8-912613387b04\e6d408fb-49e2-45aa-a9f8-fa9843d40c87\local_fef978ab-fbf7-4aed-84ae-533f52267181\outputs\pre-continuous-object-light.html"
$targetLong = "\\?\$target"
$backupLong = "\\?\$backup"

$beforeBytes = [System.IO.File]::ReadAllBytes($targetLong)
[System.IO.File]::WriteAllBytes($backupLong, $beforeBytes)
$afterBytes = [System.IO.File]::ReadAllBytes($backupLong)

$sha = [System.Security.Cryptography.SHA256]::Create()
try {
  $beforeHash = ([BitConverter]::ToString($sha.ComputeHash($beforeBytes))).Replace('-', '')
  $afterHash = ([BitConverter]::ToString($sha.ComputeHash($afterBytes))).Replace('-', '')
} finally {
  $sha.Dispose()
}
if ($beforeHash -ne $afterHash) { throw 'Backup hash mismatch; target not replaced.' }
```

Do not continue unless the backup exists at the exact path and hashes match.

- [ ] **Step 6: Replace and reverify the target**

Write the already-verified trial bytes to the long target path:

```powershell
$trial = "C:\Users\longt\.codex\visualizations\2026\07\29\019fae9f-3167-7211-bbed-6998cd3c6de3\ai-factory-atom-continuous-object-light.html"
$trialBytes = [System.IO.File]::ReadAllBytes($trial)
[System.IO.File]::WriteAllBytes($targetLong, $trialBytes)
```

Re-run the focused contract and module syntax check against the target. Serve
the output directory on `127.0.0.1:8766`, request the cache-busted target, and
confirm:

- trial SHA-256 equals target SHA-256;
- HTTP payload SHA-256 equals target SHA-256;
- HTTP status is `200`;
- cache-busted canvas is ready;
- fallback is hidden;
- WebGL has not failed;
- browser logs are empty.

- [ ] **Step 7: Record final evidence**

Write exact hashes, URLs, frame paths, phase samples, interaction results,
reduced-motion results, and browser logs to:

```text
C:\Users\longt\Music\KietAI\Persional-AI-Assistant\.superpowers\sdd\continuous-object-light-task-3-report.md
```

No implementation commit is required because the delivered HTML lives outside
Git.
