# HMER Attention Map and Ink Canvas Implementation Plan

> **For agentic workers:** implement task by task with TDD (`test-driven-development`, `incremental-implementation`). Steps use checkbox (`- [ ]`) syntax for tracking. The task list lives in this document (repo convention), not in `tasks/todo.md`.

**Goal:** On `/hmer`, let the user draw an expression and see, for each LaTeX token the model emits, which regions of the image it depends on.

**Architecture:** Backend: a new tensor module `hmer/occlusion.py`, used by `HmerRecognizer.explain()` for a baseline and 64 occluded teacher-forced passes, served by a separate `POST /api/hmer/explain` so recognition is untouched. Frontend: a pure export-layout module, an `InkCanvas` component, and an `EvidenceView` component, all wired into `HmerPage`. The capstone repository is not modified.

**Tech Stack:** Python 3.11 · FastAPI · PyTorch 2.13 · pytest 8.3.4 · React 18 · TypeScript · Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-23-hmer-attention-and-ink-canvas-design.md`

## Global Constraints

- Python for every command: `.venv/Scripts/python.exe` (Windows, Git Bash). Prefix live runs with `PYTHONPATH=. PYTHONIOENCODING=utf-8`.
- **Baseline before this work (2026-09-23):** backend **598 passed, 17 skipped, 0 failed**; frontend **279 tests in 40 files passed**; `npm run typecheck` clean. Any existing test that has to change is evidence of an unintended break. Investigate before editing it.
- Recognition output (`latex`, `score`) for a given image must not change. The explanation pass is read-only.
- Existing tests in `tests/test_hmer.py` never import `comer`. New unit tests keep that property; real-model tests are opt-in (`skipif`) and never run in CI.
- `comer` stays out of `uv.lock` (spec §12 Q1). The only lockfile change is the Windows CUDA torch source (spec §12 D1a), made in T1. After installing `comer`, always sync with `uv sync --dev --inexact`.
- No retraining (spec §12 Q2). The checkpoint is `C:/Users/longt/Downloads/CoMER/checkpoints/ComerSwin-epoch=02-val_ExpRate=0.4713.ckpt`. The map is occlusion-based (spec §12 D2), so it does not depend on the legacy encoder layout.
- New frontend files are `.ts`/`.tsx`. UI copy is Vietnamese; code and comments are English. Colours come from theme tokens.
- Commit after each task on branch `feat/hmer-attention-canvas`. Never use `--no-verify`. Do not push.

## File Structure

**Created:**
- `backend/app/features/hmer/occlusion.py`: occluded batch and evidence weights. Tensor code only, no model loading.
- `tests/test_hmer_occlusion.py`
- `frontend/src/lib/hmerInk.ts` + `hmerInk.test.ts`: pure export layout (bbox, scale, size cap).
- `frontend/src/components/hmer/InkCanvas.tsx` + `.test.tsx`
- `frontend/src/components/hmer/EvidenceView.tsx` + `.test.tsx`
- `tools/hmer_ink_check.py`: measures gray levels, margin and stroke width of stored images (spec §2.4 method).
- `tools/hmer_attention_spike.py`: S1/S2 spikes on ground-truth sequences (done).
- `tools/hmer_canvas_ab.py`, `tools/hmer_format_ab.py`: export-format experiments (done).
- `tools/hmer_evidence_check.py`: real-model check of the occlusion map (T8).

**Modified:**
- `backend/app/features/hmer/recognizer.py`, `service.py`, `schemas.py`, `router.py`, `tests/test_hmer.py`, `tests/contract/test_api_contracts.py`
- `frontend/src/lib/hmerApi.ts`, `pages/HmerPage.tsx`, `pages/HmerPage.test.tsx`, `styles/hmer.css`
- `README.md`: HMER setup (T1) and feature description (T11). README does not mention HMER today.
- The spec's §13 Results, filled in as tasks produce numbers.


## Dependency Graph

```
T1 runtime ──► D1 (human: CPU fast enough?) ──┬──► T4 canvas measurements
                                              │
T2 ink layout ──► T3 InkCanvas + tab ─────────┘
                                   │
T1 ──► T5 spikes (gate: attention rejected) ──► T6 occlusion.py ──► T7 /explain ──► T8 real-model check (gate) ──► T9 EvidenceView ──► T10 playback + bars ──► T11 E2E
                                                        ▲
                                  T3 (both touch HmerPage.tsx: sequential)
```

- **Parallel:** T2–T3 (frontend, disjoint files) can run while T1, T5 and T6 run (backend).
- **Sequential:** T3 before T9, because both edit `HmerPage.tsx` and `hmer.css`.
- **Riskiest first:** T1 (does the model run here, and how fast?) and T5 (does the legacy map carry any signal?) come before any UI that depends on them.

---

## Phase 1: Runtime

### Task 1: HMER recognizes the bundled sample inside KiNg

**Description:** Install `comer` into KiNg's venv without its declared dependencies, add the runtime imports it needs with pins, point `.env` at the 0.4713 checkpoint, and recognize `SwinCoMER/example/UN19_1041_em_595.bmp` through the real endpoint. Document the procedure in README, including why `--inexact` is required. Measure the CPU wall time: it decides D1.

**Acceptance criteria:**
- [x] CPU wall time recorded in spec §13.1: 415 s warm, with output matching ground truth. This triggered D1, resolved as D1a (CUDA torch via lockfile) and D1b (lazy `editdistance` import in the capstone repo).
- [x] `GET /api/hmer/status` reports `loaded: true`, `last_error: null` after one recognition, and the sample's LaTeX matches its CROHME 2019 ground truth (spec §3, criterion 2).
- [x] torch is `2.14.0+cu126` with CUDA available and torchvision `0.29.0`, and GPU wall time (first and warm) is recorded in spec §13.2.

**Verification:**
- [x] `curl -F "file=@…/UN19_1041_em_595.bmp" http://localhost:8001/api/hmer/recognize` → 200 and ground truth, on a check instance on port 8001 (`.claude/launch.json` → `backend-check`, Supabase off so no news refresh), leaving the owner's server on 8000 alone.
- [x] `PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe -m pytest -q` → 598 passed, 17 skipped, after fixing two tests that read the developer's `.env` (spec §13.2).
- [x] `uv sync --dev --inexact` and `uv run` both leave `import comer` working.

**Dependencies:** None
**Files:** `README.md`, `.env.example`, `backend/app/features/hmer/recognizer.py` (install hint), `pyproject.toml`, `uv.lock`, and local `.env` (gitignored). Outside this repo: `CapstoneProject_SP25AI12/SwinCoMER/comer/lit_comer_swin.py`, committed by the owner.
**Scope:** S

### Checkpoint D1 — human decision: is CPU fast enough? (resolved: no → spec §12 D1a, D1b)

- [ ] Present T1's warm wall time. The encoder docstring measured 107 s at beam 2 and 407 s at beam 8 on CPU for legacy checkpoints; this checkpoint's `beam_size` is 8.
- [ ] **If warm time ≤ 30 s:** continue on CPU.
- [ ] **If more:** stop and propose a GPU path for the Windows venv (a CUDA build of torch that the RTX 3050 Ti's driver 560.94 supports), with the exact install steps and its interaction with `uv sync`. That changes torch for the whole app, including the BGE reranker, so it needs explicit approval. **Do not start T4 or T7's overhead measurement until this is settled.** T2, T3, T5 and T6 do not need it: the spikes use teacher forcing, which is a single forward pass.

---

## Phase 2: Ink canvas

### Task 2: Pure export layout for drawn strokes

**Description:** `hmerInk.ts` turns vector strokes into the layout of a training-like image (spec §5.2 steps 1–3): the bbox expanded by `PEN_PX / 2`, scale `TRAIN_STROKE_PX / PEN_PX` (22 / 4), and a uniform shrink when the longer side exceeds 2200 px. Returns `null` for empty input. No DOM.

**Acceptance criteria:**
- [x] Cases pass: empty → `null`; single dot → a square of the stroke width; one horizontal stroke → height equals the output stroke width; an oversize drawing → longer side exactly 2200 with a proportionally thinner stroke. Also covered: zero margin, independence from where on the canvas the drawing sits, the height cap, a non-default pen width, and a 250 000-point drawing. The bbox uses a single loop because `Math.min(...points)` throws a `RangeError` at that size (checked in Node).
- [x] Exported constants: `PEN_PX`, `TRAIN_STROKE_PX`, `MAX_EXPORT_PX`, each with a comment citing spec §2.4.

**Verification:**
- [x] `cd frontend && npx vitest run src/lib/hmerInk.test.ts` → 9 passed.
- [x] `npm run typecheck` clean; `npm test` → 288 passed in 41 files (279 + 9); `npm run build` ok.

**Dependencies:** None
**Files:** `frontend/src/lib/hmerInk.ts`, `frontend/src/lib/hmerInk.test.ts`
**Scope:** XS

### Task 3: "Vẽ tay" tab draws, exports and recognizes

**Description:** Add input tabs "Tải ảnh" / "Vẽ tay" to `HmerPage`. `InkCanvas` captures pointer strokes (mouse, pen, touch; `touch-action: none`; pointer capture), previews them at `PEN_PX`, and has Hoàn tác / Xoá / Nhận dạng. Export renders the T2 layout on an offscreen canvas (white, black, `lineWidth` 22, dots as filled circles), binarises at 128, and sends `File("ve-tay.png")` through the existing `recognizeImage`.

**Acceptance criteria:**
- [x] Switching tabs leaves the upload path working unchanged (existing `HmerPage` tests still pass). Both panels stay mounted and are only hidden, so a drawing survives a trip to the upload tab. Arrow keys move between tabs (ARIA tabs pattern).
- [x] Undo removes the last stroke and Clear removes all. Nhận dạng is disabled while empty or busy. A second finger and non-primary mouse buttons add no ink.
- [x] In the browser, a drawn expression is recognized and the result panel shows the stored, normalised image.

**Verification:**
- [x] `cd frontend && npx vitest run src/components/hmer src/pages/HmerPage.test.tsx` → 17 passed (8 InkCanvas, 9 HmerPage).
- [x] `npm run typecheck && npm test && npm run build` → 299 passed in 42 files; build ok.
- [x] Browser pane (frontend 5174 → backend 8001, via `.claude/launch.json`): a real mouse drag draws and Hoàn tác removes it. `x + 1`, drawn as pointer-event polylines, was exported as 913×391, 2 grey levels, margins 0/0/0/1 px, median stroke 22.0 px, and recognized on `cuda:0` in 6.2 s. The result panel showed the normalised image. The only console errors were two `/api/hmer/status` calls made while the backend was still starting.
- [x] Light and dark themes checked by computed style, which also confirmed commit `4ed4082`: `hmer.css` had referenced undefined tokens (`--fg1/2/3`, `--border1`), and the metadata divider now renders.

**Observed, not a T3 criterion:** the output was `X \underline { t } = 1` (score −3.29). The code-drawn `x` is two straight crossing lines as tall as the `1`, which is an uppercase X by shape; the `+` misread is real. Straight polylines are not handwriting, so T4's experiment needs real strokes.

**Dependencies:** T2 (and T1 for the browser check)
**Files:** `components/hmer/InkCanvas.tsx`, `components/hmer/InkCanvas.test.tsx`, `pages/HmerPage.tsx`, `pages/HmerPage.test.tsx`, `styles/hmer.css`
**Scope:** M

### Task 4: The canvas export matches training images, and normalisation helps

**Description:** Add `tools/hmer_ink_check.py`, which measures gray levels, ink-to-edge margin, and median stroke width by distance transform (the spec §2.4 method) for an image path. Run it on canvas exports. Then run the spec §5.4 experiment: draw the 10 fixed expressions once, recognize the normalised export and a raw export (visible canvas `toDataURL`, sent through `recognizeImage` from browser JS, with no product code for "raw"), and count exact matches.

**Acceptance criteria:**
- [x] Every normalised export has 2 gray levels, ink touching all four edges (±1 px), and a median stroke width of 16–24 px. Five of five real exports pass (spec §13.3).
- [~] Normalised exact matches ≥ raw exact matches. **CROHME 2019, n=100: 50 vs 0.** The owner's mouse drawings, n=4: 3 vs 4, i.e. the literal criterion fails by one item. A thickening probe showed that item is not an export problem (thicker strokes made it worse). Spec §13.3 recommends keeping §5.2 as designed. **The decision is left to the owner at Checkpoint B.**
- [x] Both counts and the per-expression outputs are recorded in spec §13.3 and `assets/2026-09-24-canvas-ab.json`.

**Verification:**
- [x] `.venv/Scripts/python.exe tools/hmer_ink_check.py data/hmer/<file>.png`
- [x] `PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe tools/hmer_canvas_ab.py --crohme 100 --image PATH=GT … --out …` (208 recognitions through the running backend; uploads deleted afterwards).
- [x] Spec §13.3 updated.

Deviation from the plan: the owner drew four expressions of their own, not the ten fixed §5.4 ones. The statistical comparison therefore used CROHME ink with ground truth, and the owner's drawings serve as the mouse-drawn check.

**Dependencies:** T1, T3, D1
**Files:** `tools/hmer_ink_check.py`, the spec
**Scope:** S

### Checkpoint B: Canvas

- [ ] Backend 598 passed / 17 skipped; frontend all passing; typecheck and build clean.
- [ ] Draw → recognize works end to end in the browser.
- [ ] Review with human before Phase 3.

---

## Phase 3: Evidence map (T5 gate → occlusion, spec §12 D2)

### Task 5: Spikes S1 and S2 on ground-truth sequences

**Description:** `tools/hmer_attention_spike.py` loads the checkpoint and, for 5 wide expressions from `data.zip` (`train/`, with their captions), runs a teacher-forced pass on the **ground-truth** tokens with hooks on every decoder layer's cross-attention. It folds legacy positions `(8 × 768)` to 8 columns and prints each token's column distribution per layer (averaged over heads). Using ground truth instead of beam search keeps this to one forward pass per image, fast even on CPU, and removes misreads as a confounder.

**Acceptance criteria:**
- [x] **S1:** across the 5 samples, the first token's attention mass centres left of the last token's in at least one layer. **Passes as written, but vacuously:** mirrored and blank images give the same progression (ρ ≈ 1.00), so the maps do not depend on the image (spec §13.4).
- [—] **S2:** not chosen. No aggregation carries content.
- [x] **Gate: triggered. Stopped before T6.** A translation control confirmed it: attention stays put when the ink moves, while occlusion sensitivity moves with the ink (spec §13.4). Options go to the owner.

Also found while picking samples: §2.4 had measured the wrong training images (the `.bmp`, not the `.png` the model trained on). A held-out A/B showed no accuracy difference between the formats (36 vs 35 of 100), so the canvas export stands (spec §13.5).

**Verification:**
- [ ] `PYTHONPATH=. PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe tools/hmer_attention_spike.py`
- [ ] Spec §13 updated.

**Dependencies:** T1
**Files:** `tools/hmer_attention_spike.py`, the spec
**Scope:** S

> **Replanned 2026-09-24 after the T5 gate** (spec §12 D2). T6 onwards compute the map by occlusion (spec §4) instead of cross-attention. The superseded tasks are in git history (`3993531`).

### Task 6: `hmer/occlusion.py`, tested without the model

**Description:** The tensor half of spec §4.1–4.2, with no model loading:
- `occlusion_batch(img, rows, cols, fill)` returns `[rows*cols, C, H, W]`: copy *k* equals the input except cell *k*, which is filled.
- `evidence(lp0, lp_cells, min_total)` returns `(weights [tokens, cells], flagged [tokens])`, as in the spec §8 snippet.
- Constants `ROWS = 4`, `COLS = 16`, `EXPLAIN_BATCH = 8`, `MIN_TOTAL_DROP = 0.05`, each commented with its reason and spec reference.

**Acceptance criteria:**
- [x] Each occluded copy differs from the input in exactly its own cell. The cells tile 256 × 256 with no gaps or overlaps, including for grid sizes that do not divide 256 (10 × 7 with a 3 × 4 grid, 7 into 4, and others).
- [x] `evidence` clamps rises to 0, and each row sums to 1. A token below `min_total` gets all zeros and a flag, never a normalised noise vector.
- [x] No import of `comer`, and `torch` is imported inside functions, as in `recognizer.py`. Also: the background value is the median, so ink does not shift it, and the input tensor is never modified.

**Verification:**
- [x] `.venv/Scripts/python.exe -m pytest tests/test_hmer_occlusion.py -q` → 13 passed.
- [x] `.venv/Scripts/python.exe -m pytest -q` → 616 passed, 17 skipped; feature-boundary tests pass.

**Dependencies:** T5 (gate)
**Files:** `backend/app/features/hmer/occlusion.py`, `tests/test_hmer_occlusion.py`
**Scope:** S

### Task 7: `POST /api/hmer/explain`

**Description:** `HmerRecognizer.explain(image_bytes, tokens)` runs the baseline pass and the 64 occluded teacher-forced passes in chunks of `EXPLAIN_BATCH`. `HmerService.explain(filename, latex)` loads the stored image, validates tokens against the vocabulary, and runs under the same lock as recognition. Router and schemas follow spec §4.3; the route is added to the contract list.

**Acceptance criteria:**
- [x] Response matches spec §4.3 with its invariants. 400 for a bad filename, empty LaTeX, or an unknown token; 404 for a missing image; 503 when the model is unavailable (unit tests with a fake recognizer). Also tested with a controllable fake model, where token *i* reads ink in one known cell: explain puts each token's peak exactly on that cell, flags every token on a blank image, and runs 1 baseline pass plus 8 chunks of 8.
- [x] `/api/hmer/recognize` and its tests are unchanged. Live: same LaTeX and score (−0.1907) as before.
- [x] Opt-in real-model test (skipped unless `HMER_CHECKPOINT` is set and `comer` imports): the sample returns 27 tokens with 64 weights each. It had been miscounted as 26 in the docs; now corrected.

**Verification:**
- [x] `.venv/Scripts/python.exe -m pytest tests/test_hmer.py tests/test_hmer_occlusion.py tests/contract -q`
- [x] Full backend suite: 628 passed, 17 skipped. With `HMER_CHECKPOINT` unset, as in CI: `test_hmer.py` 30 passed, 1 skipped.
- [x] Live `POST /api/hmer/explain` on the sample: HTTP 200 in 1.56 s (`elapsed_ms`), 4 × 16. The 2D layout is right: the Σ upper limit `3` peaks in row 0, the lower limit `a = 1` in row 3, and superscript `2` sits one row above its `x`. Braces and Σ itself are flagged as no-evidence.

**Dependencies:** T6
**Files:** `recognizer.py`, `service.py`, `schemas.py`, `router.py`, `tests/test_hmer.py`, `tests/contract/test_api_contracts.py`
**Scope:** M

### Task 8: The map follows the ink on the real model (gate)

**Description:** `tools/hmer_evidence_check.py` productises the §13.4 probe against `HmerRecognizer.explain`. On the §13.4 training samples it checks the progression, the right-shift and the blank image. It also measures explain latency on the 27-token sample, and fixes `MIN_TOTAL_DROP` from the observed distribution of per-token total drops.

**Acceptance criteria:**
- [x] Spec §4.5.1: mean Spearman ρ **0.986** (≥ 0.8); mean **shift ratio 1.11** (≥ 0.7); blank image → every token flagged, 7/7. The shift criterion was corrected before the run, because "≥ 0.3 of the width" was unreachable even for a perfect map (spec §4.5.1).
- [x] Explain on the 27-token sample takes **1.49 s** warm (spec §4.5.2).
- [x] Numbers recorded in spec §13.6. `MIN_TOTAL_DROP = 0.05` is kept on the observed drop distributions.

**Verification:**
- [x] `PYTHONPATH=. PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe tools/hmer_evidence_check.py --image … --out docs/superpowers/plans/assets/2026-09-24-evidence-check.json`

**Dependencies:** T7
**Files:** `tools/hmer_evidence_check.py`, the spec
**Scope:** S

### Checkpoint C: Evidence API

- [ ] Backend suite passes.
- [ ] T8's checks pass on the real model.
- [ ] Review with human before the UI.

### Task 9: EvidenceView with overlay, token strip and auto-explain

**Description:**
- `hmerApi.ts` gains `explainImage(filename, latex)` and its types.
- After a successful recognition, `HmerPage` calls it automatically. The LaTeX renders at once, and the image panel shows a loading note until the map arrives.
- `EvidenceView` draws the `rows × cols` overlay and the token strip (hover/focus, ← / →), with the no-evidence hint, the failure note and the caption from spec §4.4.

**Acceptance criteria:**
- [x] Hovering or focusing token *i* sets cell opacities from `weights[i]`, and arrow keys move focus and the overlay together.
- [x] A no-evidence token shows its hint and an empty overlay. An explain failure shows its note, and the LaTeX panel is unaffected.
- [x] Recognition success triggers exactly one explain call, with the returned filename and LaTeX. An empty beam triggers none. No grid size is hard-coded (a test renders 2 × 3). A new recognition aborts any explain still in flight.

**Verification:**
- [x] `cd frontend && npx vitest run src/components/hmer src/pages/HmerPage.test.tsx` → 27 passed.
- [x] `npm run typecheck && npm test && npm run build` → 309 passed in 43 files; build ok.
- [x] Browser pane, real backend:
  - The capstone sample: LaTeX at 5.05 s, map at 6.48 s, 27 chips (12 flagged). Hovering `3` lights the upper limit above Σ, and hovering `1` lights the lower limit below it.
  - The owner's drawing: hovering `3` lights the drawn 3, and the image fits the panel at 615 px.
  - All requests 200 (including the explain preflight).
- Two fixes came out of the browser check:
  - `mix-blend-mode: multiply` made the overlay invisible on the sample, which is white ink on black. The overlay is now plain translucency, capped at 0.6.
  - A percentage `min-width` on the img was ignored, because it resolved against a parent that shrink-wraps the img. The size now lives on the frame (`fit-content`, min 360 px), so small scans scale up with the aspect ratio intact (checked: 360 × 208, ratio 1.729 = natural, grid aligned).

**Dependencies:** T8 (Checkpoint C), T3 (shared files)
**Files:** `lib/hmerApi.ts`, `components/hmer/EvidenceView.tsx`, `components/hmer/EvidenceView.test.tsx`, `pages/HmerPage.tsx`, `styles/hmer.css`
**Scope:** M

### Task 10: Probability bars and "Phát lại" playback

**Description:** Add a thin bar under each token chip proportional to `token_probs[i]`, with the value in the accessible name. "Phát lại" steps through tokens at about 400 ms each, stops on hover or focus, and is disabled under `prefers-reduced-motion`.

**Acceptance criteria:**
- [x] Bar widths follow `token_probs`, and accessible names include the value (for example "x, xác suất 0.95"; flagged chips add ", không có vùng riêng").
- [x] Playback advances on a fake timer and stops on hover or focus. It walks only tokens with evidence, so flagged braces do not flash an empty map mid-sweep.
- [x] With reduced motion matched, the button is disabled, and CSS drops the cell transition.

**Verification:**
- [x] `cd frontend && npx vitest run src/components/hmer/EvidenceView.test.tsx` → 11 passed.
- [x] `npm run typecheck && npm test && npm run build` → 313 passed in 43 files; build ok.
- [x] Browser pane, owner's `7a+3=6`: playback went 7 → a → + → 3 → = → 6 at ~400 ms steps, showing "Dừng" while running and "Phát lại" after. Bars at 83 / 95 / 100 / 100 / 100 / 77 %.

**Dependencies:** T9
**Files:** `components/hmer/EvidenceView.tsx`, `components/hmer/EvidenceView.test.tsx`, `styles/hmer.css`
**Scope:** S

### Task 11: End-to-end in the browser, and close out

**Description:** Drive the real flow in the in-app browser: draw → Nhận dạng → the map arrives → hover tokens → Phát lại → keyboard-only pass. Also upload the mirrored sample and check the map mirrors, which is the demo-proof version of T8. Check both themes and the mobile preset, and take screenshots as proof. Add HMER to README's feature list, and fill the remaining §13 entries.

**Acceptance criteria:**
- [ ] Full flow works with zero console errors, in both themes and on the mobile preset.
- [ ] README describes `/hmer`: upload, draw, evidence map with its meaning, and setup (from T1).
- [ ] Spec §13 complete, and spec status set to implemented.

**Verification:**
- [ ] Browser-pane screenshots: the map on a drawing, and on the mirrored sample.
- [ ] Final run: backend and frontend suites, typecheck and build.

**Dependencies:** T4, T10
**Files:** `README.md`, the spec
**Scope:** S

### Checkpoint: Complete

- [ ] Every spec success criterion (§3, §4.5, §5.3) is checked off or explicitly recorded as not met, with the reason.
- [ ] Review with human; decide on merging `feat/hmer-attention-canvas`.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| CPU inference takes minutes per image (docstring: 407 s at beam 8, legacy) | High: the demo is unusable, and T4 (20 recognitions) would take hours | D1 measures before anything depends on it. Spikes use teacher forcing (one forward pass). A GPU path needs approval because it swaps torch for the whole app. |
| Installing comer's imports drags torch to another version | High: breaks the reranker and the suite | `--no-deps` for `comer`, explicit pins, and a check that torch is unchanged is an acceptance criterion in T1. |
| `uv sync` without `--inexact` silently uninstalls `comer` | Medium | README warning (T1). `/api/hmer/status` already reports the missing package clearly. |
| ~~Legacy attention maps carry no signal~~ | **Happened (T5):** attention is content-independent | Caught by the T5 gate with mirrored/blank/shift controls; replaced by occlusion (spec §12 D2). |
| Occlusion maps are noisy or flat on real drawings | Medium: the demo would mislead | T8 gate: progression, shift and blank checks on the real model before any UI. |
| Explain latency or VRAM | Medium | Chunks of 8 (747 MiB, ~3 s measured); a separate endpoint, so the LaTeX never waits; the same lock as recognition. |
| Structural tokens (`{`, `}`, `^`) have no single-cell evidence | Low | Flagged as no-evidence with a hint, rather than normalising noise. |
| First model load needs network (timm pretrained download) | Low | Run T1 online. This is already documented in `recognizer.py`. |
| jsdom cannot rasterise canvas | Low | The layout is pure and unit-tested (T2); rasterisation and binarisation are verified by measurement in T4. |
| Viewers read the map as "why" | Low | UI copy says "vùng mô hình dựa vào" and the caption explains occlusion (spec §4.4). |
