# HMER Attention Map and Ink Canvas Implementation Plan

> **For agentic workers:** implement task by task with TDD (`test-driven-development`, `incremental-implementation`). Steps use checkbox (`- [ ]`) syntax for tracking. The task list lives in this document (repo convention), not in `tasks/todo.md`.

**Goal:** On `/hmer`, let the user draw an expression and see, for each LaTeX token the model emits, where on the image the decoder was looking.

**Architecture:** Backend: a new pure/tensor module `hmer/attention.py`, used by `HmerRecognizer` for one teacher-forced pass after the beam search. The recognize response gains three additive fields. Frontend: a pure export-layout module, an `InkCanvas` component, and an `AttentionView` component, all wired into `HmerPage`. The capstone repository is not modified.

**Tech Stack:** Python 3.11 · FastAPI · PyTorch 2.13 · pytest 8.3.4 · React 18 · TypeScript · Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-23-hmer-attention-and-ink-canvas-design.md`

## Global Constraints

- Python for every command: `.venv/Scripts/python.exe` (Windows, Git Bash). Prefix live runs with `PYTHONPATH=. PYTHONIOENCODING=utf-8`.
- **Baseline before this work (2026-09-23):** backend **598 passed, 17 skipped, 0 failed**; frontend **279 tests in 40 files passed**; `npm run typecheck` clean. Any existing test that has to change is evidence of an unintended break. Investigate before editing it.
- Recognition output (`latex`, `score`) for a given image must not change. The explanation pass is read-only.
- Existing tests in `tests/test_hmer.py` never import `comer`. New unit tests keep that property; real-model tests are opt-in (`skipif`) and never run in CI.
- `comer` stays out of `uv.lock` (spec §12 Q1). The only lockfile change is the Windows CUDA torch source (spec §12 D1a), made in T1. After installing `comer`, always sync with `uv sync --dev --inexact`.
- No retraining (spec §12 Q2). The checkpoint is `C:/Users/longt/Downloads/CoMER/checkpoints/ComerSwin-epoch=02-val_ExpRate=0.4713.ckpt`, and `mode: "columns"` is the only mode that runs against a real model.
- New frontend files are `.ts`/`.tsx`. UI copy is Vietnamese; code and comments are English. Colours come from theme tokens.
- Commit after each task on branch `feat/hmer-attention-canvas`. Never use `--no-verify`. Do not push.

## File Structure

**Created:**
- `backend/app/features/hmer/attention.py`: grid folding, cross-attention hook capture, token alignment, token probabilities. Tensor code only, no model loading.
- `tests/test_hmer_attention.py`
- `frontend/src/lib/hmerInk.ts` + `hmerInk.test.ts`: pure export layout (bbox, scale, size cap).
- `frontend/src/components/hmer/InkCanvas.tsx` + `.test.tsx`
- `frontend/src/components/hmer/AttentionView.tsx` + `.test.tsx`
- `tools/hmer_ink_check.py`: measures gray levels, margin and stroke width of stored images (spec §2.4 method).
- `tools/hmer_attention_spike.py`: S1/S2 spikes on ground-truth sequences.

**Modified:**
- `backend/app/features/hmer/recognizer.py`, `schemas.py`, `router.py`, `tests/test_hmer.py`
- `frontend/src/lib/hmerApi.ts`, `pages/HmerPage.tsx`, `pages/HmerPage.test.tsx`, `styles/hmer.css`
- `README.md`: HMER setup (T1) and feature description (T10). README does not mention HMER today.
- The spec's §13 Results, filled in as tasks produce numbers.

`HmerService` is unchanged: it already passes the `Recognition` through.

## Dependency Graph

```
T1 runtime ──► D1 (human: CPU fast enough?) ──┬──► T4 canvas measurements
                                              │
T2 ink layout ──► T3 InkCanvas + tab ─────────┘
                                   │
T1 ──► T5 spikes ──► T6 attention.py ──► T7 API ──► T8 AttentionView ──► T9 playback + bars ──► T10 E2E
                                                        ▲
                                  T3 (both touch HmerPage.tsx: sequential)
```

- **Parallel:** T2–T3 (frontend, disjoint files) can run while T1, T5 and T6 run (backend).
- **Sequential:** T3 before T8, because both edit `HmerPage.tsx` and `hmer.css`.
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

## Phase 3: Attention

### Task 5: Spikes S1 and S2 on ground-truth sequences

**Description:** `tools/hmer_attention_spike.py` loads the checkpoint and, for 5 wide expressions from `data.zip` (`train/`, with their captions), runs a teacher-forced pass on the **ground-truth** tokens with hooks on every decoder layer's cross-attention. It folds legacy positions `(8 × 768)` to 8 columns and prints each token's column distribution per layer (averaged over heads). Using ground truth instead of beam search keeps this to one forward pass per image, fast even on CPU, and removes misreads as a confounder.

**Acceptance criteria:**
- [ ] **S1:** across the 5 samples, the first token's attention mass centres left of the last token's in at least one layer. Record the verdict in §13. **If it fails, stop and revise spec §2.3** (the surviving axis may be rows).
- [ ] **S2:** choose `ATTENTION_LAYERS`, a single layer or a mean over layers, as the aggregation with the clearest left-to-right progression, and record why in §13.
- [ ] **Gate:** if no layer shows progression, even at 8-band resolution, stop and discuss with the human before T6. A UI built over noise would be a demo that misleads.

**Verification:**
- [ ] `PYTHONPATH=. PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe tools/hmer_attention_spike.py`
- [ ] Spec §13 updated.

**Dependencies:** T1
**Files:** `tools/hmer_attention_spike.py`, the spec
**Scope:** S

### Task 6: `hmer/attention.py`, tested without the model

**Description:** Pure and tensor pieces, each unit-tested with fakes:
- `fold_to_image_grid(attn, legacy, cols)`, as in spec §8;
- `capture_cross_attention(layers, reduce)`, a context manager that registers a forward hook on each `layer.multihead_attn`, reduces immediately (head mean → fold → CPU), and removes every handle in `finally`;
- `align_tokens(seq, idx2word)`, which maps unknown ids to `"<unk>"` so nothing shifts;
- `token_probabilities(logits, seq)`, which drops the EOS row.

**Acceptance criteria:**
- [ ] Legacy mass placed at `(j, c)` folds to column `j`; corrected input stays row-major; each row sums to 1.
- [ ] No hook handles remain after the context exits normally **or** by an exception, verified on a fake `nn.Module` decoder.
- [ ] n tokens → n rows and n probabilities, including with an unknown id.

**Verification:**
- [ ] `.venv/Scripts/python.exe -m pytest tests/test_hmer_attention.py -q`
- [ ] `.venv/Scripts/python.exe -m pytest -q` → 598 + new passed, 17 skipped.

**Dependencies:** T5 (its axis verdict fixes the legacy fold)
**Files:** `backend/app/features/hmer/attention.py`, `tests/test_hmer_attention.py`
**Scope:** S

### Task 7: `/api/hmer/recognize` returns tokens, probabilities and attention

**Description:** After the beam search and under the same lock, `HmerRecognizer` runs one teacher-forced pass with `[SOS] + seq` using the T6 pieces and `ATTENTION_LAYERS`. `Recognition` and `RecognizeResponse` gain `tokens`, `token_probs` and `attention` (spec §4.3). An explanation failure is logged with `logger.exception` and yields `null`s. An empty hypothesis yields `tokens: []` and `attention: null`.

**Acceptance criteria:**
- [ ] Response matches spec §4.3, including its invariants. Old fields are unchanged, and `latex`/`score` are identical when the explanation raises (unit test with a fake recognizer internals).
- [ ] On the real sample: `mode: "columns"`, `rows: 1`, `cols: 8`, and `" ".join(tokens) == latex`.
- [ ] Explanation overhead is under 10% of warm recognition time on this machine (recorded in §13).

**Verification:**
- [ ] `.venv/Scripts/python.exe -m pytest tests/test_hmer.py tests/test_hmer_attention.py -q`
- [ ] Opt-in: `HMER_CHECKPOINT=... .venv/Scripts/python.exe -m pytest tests/test_hmer.py -q -k real_model`
- [ ] `curl` the sample and inspect the JSON.

**Dependencies:** T6, D1
**Files:** `backend/app/features/hmer/recognizer.py`, `schemas.py`, `router.py`, `tests/test_hmer.py`
**Scope:** M

### Checkpoint C: Attention API

- [ ] Backend suite passes (598 + new, 17 skipped plus the opt-in test when unset).
- [ ] The real response for the sample looks sane: token masses progress left to right.
- [ ] Review with human before the UI.

### Task 8: AttentionView with overlay and token strip

**Description:** `HmerResult` gains the optional fields. `AttentionView` replaces the "Ảnh đã nhận" panel content: a `rows × cols` CSS grid over the image (wrapper sized by the img, `inset: 0`, opacity = weight / max, `var(--accent-hmer)` tint, blur), plus a strip of token `<button>`s. Hover or focus makes a token active, and ← / → move between tokens. The `mode: "columns"` note and the `attention: null` note are as in spec §4.4.

**Acceptance criteria:**
- [ ] Hovering or focusing token *i* sets cell opacities from `weights[i]`, and arrow keys move focus and the overlay together.
- [ ] The columns note shows for `mode: "columns"`; the null note shows and the image still renders for `attention: null`.
- [ ] No grid size is hard-coded: a test renders `rows: 8, cols: 8` too.

**Verification:**
- [ ] `cd frontend && npx vitest run src/components/hmer/AttentionView.test.tsx src/pages/HmerPage.test.tsx`
- [ ] `npm run typecheck && npm test && npm run build`

**Dependencies:** T7 (contract), T3 (shared files)
**Files:** `lib/hmerApi.ts`, `components/hmer/AttentionView.tsx`, `components/hmer/AttentionView.test.tsx`, `pages/HmerPage.tsx`, `styles/hmer.css`
**Scope:** M

### Task 9: Probability bars and "Phát lại" playback

**Description:** Add a thin bar under each token chip proportional to `token_probs[i]`, with the value in the accessible name ("x, xác suất 0.93"). The "Phát lại" button steps through tokens at about 400 ms each, stops on any hover or focus, and is disabled under `prefers-reduced-motion`.

**Acceptance criteria:**
- [ ] Bar widths follow `token_probs`; accessible names include the value; `token_probs: null` shows no bars.
- [ ] Playback advances the active token on a fake timer and stops on hover or focus.
- [ ] With reduced motion matched, the button is disabled and no transitions run.

**Verification:**
- [ ] `cd frontend && npx vitest run src/components/hmer/AttentionView.test.tsx`
- [ ] `npm run typecheck && npm test && npm run build`

**Dependencies:** T8
**Files:** `components/hmer/AttentionView.tsx`, `components/hmer/AttentionView.test.tsx`, `styles/hmer.css`
**Scope:** S

### Task 10: End-to-end in the browser, and close out

**Description:** Drive the real flow in the in-app browser: draw an expression → Nhận dạng → hover tokens → Phát lại → keyboard-only pass. Check both themes and the mobile preset (touch drawing). Take a screenshot as proof. Add HMER to README's feature list. Fill the remaining §13 entries and set the spec status to implemented.

**Acceptance criteria:**
- [ ] Full flow works with zero console errors in both themes and on the mobile preset.
- [ ] README describes `/hmer` (upload, draw, attention view, the columns-only limitation, and the setup from T1).
- [ ] Spec §13 is complete.

**Verification:**
- [ ] Browser pane screenshots of the attention view mid-playback.
- [ ] Final run: backend 598 + new passed / 17 skipped; frontend all passing; typecheck and build clean.

**Dependencies:** T4, T9
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
| S1 fails (the surviving legacy axis is rows) | Medium | Gate in T5 before any code builds on it. The API already carries `rows`/`cols`, so only the fold and the spec change. |
| Legacy 8-band maps carry no visible signal | Medium: the headline feature would mislead | T5 gate: stop and discuss before T6 rather than shipping a pretty overlay over noise. |
| First model load needs network (timm pretrained download) | Low | Run T1 online. This is already documented in `recognizer.py`. |
| jsdom cannot rasterise canvas | Low | The layout is pure and unit-tested (T2); rasterisation and binarisation are verified by measurement in T4. |
| Viewers read attention as "why" | Low | UI copy says "mô hình nhìn vào đâu" (spec §2.5), and the columns note explains the strips. |
