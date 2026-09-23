# HMER: Attention Map and Ink Canvas

**Date:** 2026-09-23

**Status:** Approved design (open questions resolved in §12); implementation plan in `docs/superpowers/plans/2026-09-23-hmer-attention-and-ink-canvas.md`

**Scope:** Two additions to `/hmer`: (1) for each LaTeX token the model emits, show where on the image the decoder was looking; (2) let the user draw an expression instead of uploading a photo. Plus the prerequisite neither can skip: getting SwinCoMER to actually run inside KiNg on this machine. Backend changes stay inside `backend/app/features/hmer/`. Frontend changes stay inside the HMER page and `components/hmer/`. Nothing changes in the capstone repository.

Does not change: the LaTeX or score returned for any given image, existing endpoint paths or fields, any other feature.

## 0. Capability map

| Module id | Responsibility | Depends on |
|---|---|---|
| `hmer-runtime` | SwinCoMER loads and recognizes inside KiNg's environment | — |
| `hmer-ink-canvas` | Draw-to-recognize input whose export matches the training images | `hmer-runtime` (verification only; the code has no dependency) |
| `hmer-attention` | Per-token cross-attention maps and token probabilities: API + overlay UI | `hmer-runtime` |

Build order: `hmer-runtime` → `hmer-ink-canvas` → `hmer-attention`.

The canvas goes before the attention view even though the attention view is the headline: it is small, frontend-only, and it produces controlled inputs for developing the overlay. When you drew the expression yourself you know where every symbol is, so a wrong map is obvious.

## 1. Objective

**Attention map.** Today the recognizer is a black box that returns a LaTeX string and an uncalibrated score. The only checkpoint that works (§2.2) has a validation ExpRate of 0.47, so roughly one expression in two has at least one wrong token, and the user cannot tell which one or why. A per-token map answers "what was the model looking at when it wrote this token". That is a debugging tool for misreads, and it is also the part of a portfolio demo that shows the model is understood, not just wrapped.

**Ink canvas.** Upload-only means the user needs a photo, and photos differ from the training data in every property we can measure (§2.4). A canvas records strokes as vectors, so the exported image can be rebuilt to match the training data by construction.

**Users:** the owner, demonstrating the capstone model on the portfolio site, and anyone using `/hmer` to turn handwriting into LaTeX.

## 2. What the code and data actually say

Verified on this machine on 2026-09-23. Every item below shaped a design decision.

### 2.1 HMER has never run inside KiNg here

- `import comer` fails in `.venv` (`ModuleNotFoundError`).
- `.env` has no `HMER_CHECKPOINT`.
- The last HMER commit is `59497e6 wip: tính năng HMER ... đang làm dở`.

So `hmer-runtime` is real work, not a formality.

### 2.2 Only one checkpoint is usable, and its encoder runs in legacy mode

| Checkpoint | vocab_size | `projection.0.weight` | ARM |
|---|---|---|---|
| `Downloads/CoMER/checkpoints/ComerSwin-epoch=02-val_ExpRate=0.4713.ckpt` | 236 | `(512, 8, 1, 1)` → legacy | no |
| `Downloads/CoMER/checkpoints/ComerSwin-epoch=02-val_ExpRate=0.4245.ckpt` | 225 | `(512, 8, 1, 1)` → legacy | no |
| `Downloads/CoMER/lightning_logs/version_0/checkpoints/epoch=151-…-val_ExpRate=0.6365.ckpt` | — | DenseNet CoMER (the 2022 upstream release) | yes |

- `comer/datamodule/dictionary.txt` has 233 entries plus 3 special tokens = 236, so **only the 0.4713 checkpoint matches the vocabulary**. The 0.4245 checkpoint would load and then emit the wrong tokens without any error.
- The 0.6365 checkpoint is the original DenseNet CoMER: its keys contain `growth_rate` and no `backbone`. `LitCoMER` from `lit_comer_swin` cannot load it.
- 0.4713 hyperparameters: `d_model` 512, `nhead` 8, 4 decoder layers, coverage (ARM) off, beam size 8.

### 2.3 Legacy mode decides what a map can show

In legacy mode (see the `swin_encoder.py` module docstring), timm's NHWC feature map `[B, H=8, W=8, C=768]` goes unchanged into `Conv2d(in_channels=8)`. Conv2d reads axis 1, the image **rows**, as channels. The grid the decoder attends over is therefore `(W, C)`: 8 image columns × 768 feature channels = 6144 positions. The docstring calls this "(H, C)". The numbers are the same because H = W = 8, but by tensor layout the axis that survives is the column axis.

Consequences:

- Memory position `(j, c)` depends only on column band `j`, because the 1×1 projection mixes the 8 rows of that column. Summing attention over `c` gives an exact distribution over **8 vertical bands**, each 1/8 of the image width.
- **There is no vertical localisation.** Numerator vs denominator, or superscript vs baseline, cannot be told apart.
- A corrected checkpoint (`legacy_hw_as_channels == False`) attends over an 8×8 grid of 64 cells, each 1/8 × 1/8 of the image. It is still coarse (a 20-token expression shares 8 columns), but it is two-dimensional.

**How the design handles this:** the API is grid-agnostic (§4.3). Legacy returns `rows=1, cols=8`; corrected returns `rows=8, cols=8`. The UI never hard-codes a grid, so the feature upgrades by itself when a retrained checkpoint lands.

**Not yet verified:** that axis 0 of the legacy grid is columns and not rows. The derivation above comes from reading code. Spike S1 (§4.1) must confirm it on real images before the overlay is built on top of it.

### 2.4 Training images, measured

Random samples from the CROHME `train/` images in `data.zip`:

| Property | Value |
|---|---|
| Polarity | dark ink on white; median mean pixel value 245 |
| Gray levels | 2 (binary) |
| Margin | none: ink bbox height / image height, median 1.00 |
| Size | median 768 × 373 px, aspect ratio 2.25 |
| Stroke width | median 22 px, IQR 16–24 (distance-transform estimate) |

A phone photo (grey paper, shadows, ruled lines, margins, antialiasing) differs on every row of this table. A canvas export can match every row.

### 2.5 Attention is recoverable without touching the capstone repo

`TransformerDecoderLayer.multihead_attn` returns `(output, attention)`, with `attention` shaped `[(b·nhead), t, l]`: per head, after softmax, and after ARM when ARM exists. A forward hook on each `decoder.model.layers[i].multihead_attn` captures it.

**Faithfulness.** The joint search (`comer/utils/generation_utils.py`, the block after the first beam search) rescores each hypothesis with the opposite-direction decoder using teacher forcing. A hypothesis from the l2r beam was already processed by the l2r decoder step by step, and the decoder recomputes the whole prefix with a causal mask each step, so row `i` is the same as under teacher forcing. A hypothesis from the r2l beam is processed by the l2r decoder during rescoring. Either way, one teacher-forced **l2r** pass over the returned sequence reproduces exactly the cross-attention the l2r decoder computed on it during the search. It is not an approximation. What it does not show is the r2l decoder's view.

**Caveat on meaning.** The last Swin stage (8×8 grid, window 16) attends globally, so every memory position carries context from the whole image. The map shows where on the encoder's grid the decoder read from. That lines up with image location through positional structure, but it is not a pixel attribution. UI copy says "mô hình nhìn vào đâu", never "vì sao".

## 3. Module `hmer-runtime`

**Goal:** `POST /api/hmer/recognize` returns a correct result for the bundled sample `SwinCoMER/example/UN19_1041_em_595.bmp`.

1. **Install `comer` without its declared dependencies.** `setup.py` feeds `requirements.txt` into `install_requires`. That file pins `matplotlib==3.5.1` (KiNg pins 3.10.8) and `einops==0.3.0`, and it includes dev tools (flake8, black, jupyter). Install with `--no-deps`, then install the runtime imports explicitly.
2. **Runtime imports:** pytorch-lightning, timm, einops, editdistance, torchmetrics, torchvision, albumentations, opencv (headless). `from comer.datamodule import vocab` runs `datamodule.py → dataset.py → transforms.py`, which imports `cv2` and `albumentations` at module level. So cv2 is needed even though KiNg never trains.
3. **Pin timm to 1.0.29**, the version in the capstone venv. The legacy path hands the backbone tensor unchanged to `Conv2d(in=8)`, which only works when timm emits NHWC. A timm that emits NCHW breaks the legacy checkpoint on its first forward pass.
4. **Pin torchvision to the release paired with KiNg's torch 2.13.0.** Confirm afterwards that torch is still 2.13.0. An unpinned torchvision install can pull a new torch.
5. **Stop `uv sync` from removing it.** `uv sync` removes packages that are not in `uv.lock` by default. Because `comer` stays out of the lockfile (§12 Q1), local setup always uses `uv sync --dev --inexact`. A plain `uv sync --dev` silently uninstalls HMER, which `/api/hmer/status` then reports as the missing-package error.
6. **Configure `.env`:** `HMER_CHECKPOINT=C:/Users/longt/Downloads/CoMER/checkpoints/ComerSwin-epoch=02-val_ExpRate=0.4713.ckpt`.

Known and unchanged: the first load downloads timm ImageNet weights and then overwrites them (NOTE in `recognizer.py`), so the first load needs network access.

**Success criteria**

1. After one recognition, `GET /api/hmer/status` reports `loaded: true` and `last_error: null`.
2. The sample image's output matches the result in `SwinCoMER/example/example.ipynb`.
3. `uv run pytest -q` still passes. CI is unaffected: it never installs `comer`, and the HMER tests use fakes.
4. Recognition wall time for the sample on this machine is recorded in §13, with the device. This is the baseline for the overhead criterion in §4.5.

## 4. Module `hmer-attention`

### 4.1 Spikes before any UI

- **S1, axis check.** Dump the raw legacy attention for 5 wide expressions from `data.zip`, using a teacher-forced pass on their **ground-truth** tokens. That is one forward pass per image, so it is fast even on CPU, and it keeps misreads from confounding the check. The first token's mass must sit in the leftmost bands and the last token's in the rightmost. If not, the column hypothesis in §2.3 is wrong: stop and revise this spec.
- **S2, aggregation.** For the same samples, compare the per-layer maps (4 layers, each averaged over its 8 heads). Pick one aggregation, either a single layer or the mean of several, and record it as the constant `ATTENTION_LAYERS` in `recognizer.py` with the reason.

Record both results in §13.

### 4.2 Backend

- In `HmerRecognizer.recognize`, after the beam search and under the same lock, run one teacher-forced pass `decoder(feature, mask, [SOS] + seq)` with hooks on each decoder layer's cross-attention.
- **Hooks reduce immediately:** average over heads, fold to the image grid, move to CPU. Nothing holds the raw `8 × (n+1) × 6144` tensor per layer. Remove the handles in `finally`, because a hook left registered would fire on every later beam-search step.
- **Row alignment:** row `i` (input `[SOS, t1..ti]`) is the step that emitted `t(i+1)`. The last row, which emits EOS, is dropped, so n tokens get n rows.
- **Token probabilities:** `token_probs[i] = softmax(logits[i])[seq[i]]` from the same pass, at temperature 1. They are not calibrated, and the UI treats them as relative.
- **Tokens** are built as `[vocab.idx2word.get(i, "<unk>") for i in seq]`, not with `indices2words`. The latter silently drops unknown ids, which would misalign tokens and rows.
- **An explanation failure never fails recognition.** Log it with `logger.exception` and return `attention: null, token_probs: null`. The LaTeX and score are the same either way.
- **Empty hypothesis:** `tokens: []`, `attention: null`.

**Cost:** one encoder pass plus one decoder pass of length n+1. The beam search costs about n steps × 16 sequences (8 beams × 2 directions) plus rescoring, so the overhead should be small. §4.5 sets the limit.

### 4.3 API contract

Additive only. Existing fields keep their meaning.

```python
class AttentionMap(BaseModel):
    rows: int                    # 1 for legacy checkpoints (§2.3)
    cols: int
    mode: Literal["grid", "columns"]
    weights: list[list[float]]   # per token: rows*cols floats, row-major, sums to 1, 4 dp


class RecognizeResponse(BaseModel):
    filename: str
    latex: str
    score: float
    elapsed_ms: int
    device: str
    tokens: list[str] = []
    token_probs: list[float] | None = None
    attention: AttentionMap | None = None
```

- **Invariants:** when not null, `len(tokens) == len(token_probs) == len(attention.weights)`, and every `weights` row has `rows * cols` entries.
- **Coordinates:** the 256×256 resize is a pure scale with no crop or pad, so cell `(r, c)` covers the fractional box `[c/cols, (c+1)/cols] × [r/rows, (r+1)/rows]` of the image **as uploaded**. The overlay needs no knowledge of the model's input size.
- **Payload:** 8 floats per token for legacy, 64 for corrected; about 20 KB for a 40-token expression.
- `HmerResult` in `frontend/src/lib/hmerApi.ts` gets the same optional fields.

### 4.4 UI

The "Ảnh đã nhận" panel becomes the attention view:

- **Overlay.** A CSS grid of `rows × cols` cells over the image. The img sits in a wrapper sized by the img, and the overlay uses `inset: 0`. Each cell's opacity is its weight divided by the active token's maximum weight, tinted with `var(--accent-hmer)` and softened with a blur. No `<canvas>`, so it can be tested in jsdom.
- **Token strip.** Under the image, one `<button>` per token, in monospace, showing the raw token as emitted (`\frac`, `{`, `^`, …). Hover or focus makes a token active, and ← / → move between tokens. A thin bar under each chip is proportional to its `token_prob`; the exact value is in the accessible name (for example "x, xác suất 0.93").
- **"Phát lại" button.** Steps through the tokens at about 400 ms each, so a viewer sees the model read left to right without knowing to hover. It stops on any hover or focus and is disabled under `prefers-reduced-motion`.
- **`mode: "columns"`.** A one-line note, "Checkpoint hiện tại chỉ định vị được theo chiều ngang (8 dải dọc).", so the vertical strips are not read as a bug.
- **`attention: null`.** The image shows as it does today, with "Không lấy được bản đồ attention cho ảnh này."
- The image background is always white (`.hmer-thumb`). The tint comes from the theme token, so both themes work.

### 4.5 Success criteria

1. S1 confirms the axis, or this spec is revised before the UI is built.
2. For the sample image, the invariants in §4.3 hold, and `" ".join(tokens) == latex` when there is no `<unk>`.
3. The LaTeX and score are identical with and without the explanation pass. Checked by a unit test with fakes and by hand on the real model.
4. The explanation adds less than 10% to recognition wall time on this machine, against the §3 baseline.
5. No hook handles remain registered after `recognize`, whether it succeeded or raised (unit test).
6. Keyboard: every token can be reached with Tab and the arrow keys, and the overlay follows focus.
7. `uv run pytest -q`, `npm run typecheck`, `npm test` and `npm run build` pass.

## 5. Module `hmer-ink-canvas`

### 5.1 Behaviour

- The HMER page gets two input tabs: "Tải ảnh" (the current dropzone) and "Vẽ tay".
- **Canvas.** Pointer events (mouse, pen, touch) with `touch-action: none` and pointer capture. The pen has a fixed width `PEN_PX = 4` CSS px with round caps and joins. Pressure is ignored because training strokes have constant width.
- **Buttons:** "Hoàn tác" (drop the last stroke), "Xoá", and "Nhận dạng" (disabled while the canvas is empty or a request is running).
- Strokes are stored as vectors (`{x, y}[][]` in CSS px). The visible canvas is only a preview and is never exported directly.

### 5.2 Export: rebuild the image the way training images look (§2.4)

1. Take the bounding box of all points, expanded by `PEN_PX / 2` so stroke edges fall inside. Training crops have no margin.
2. Scale by `s = TRAIN_STROKE_PX / PEN_PX` with `TRAIN_STROKE_PX = 22`, so output strokes are 22 px wide. A line written 60 px tall becomes about 330 px tall, close to the training median of 373.
3. If the longer side exceeds 2200 px (about the largest training width, 2181), shrink everything uniformly. Strokes get proportionally thinner; that is accepted.
4. Render on an offscreen canvas: white fill, black strokes with `lineWidth` 22, and single-point strokes as filled dots (the dot on an `i`, a decimal point).
5. Binarise at threshold 128 using `getImageData`. Canvas antialiasing cannot be turned off, and training images have 2 levels.
6. Wrap the PNG blob in `File("ve-tay.png")` and send it through the existing `recognizeImage`. The stored image shown in the result is exactly what the model saw.

Steps 1–3 are a pure function in `frontend/src/lib/hmerInk.ts` and are unit-tested. Steps 4–5 need a real canvas and are verified in the browser.

### 5.3 Success criteria

1. The pure layout function passes unit tests for: empty input, a single dot, one horizontal stroke, and an oversize drawing.
2. The exported image, measured with the §2.4 method, has 2 gray levels, ink touching all four edges (±1 px), and a median stroke width within the training IQR of 16–24 px.
3. **The normalisation must earn its place.** On the fixed set of 10 expressions in §5.4, drawn once and exported both ways, the normalised export gets at least as many exact matches as a raw canvas export (margins, antialiasing, screen-size strokes). Record both counts in §13.
4. Drawing works with the mouse and under touch emulation (the browser pane's mobile preset).

### 5.4 Fixed test expressions

`x^2+y^2` · `\frac{a}{b}` · `\sqrt{x+1}` · `a_{i}+b_{i}` · `\sum_{i=1}^{n} i` · `e^{-x}` · `2x-3=5` · `\sin \theta` · `\int_{0}^{1} x dx` · `(a+b)^{2}`

## 6. Commands

```bash
# backend
uv run uvicorn main:app --reload --port 8000
uv run pytest tests/test_hmer.py -q
uv run pytest -q

# frontend
cd frontend && npm run dev
cd frontend && npm run typecheck && npm test && npm run build

# hmer-runtime, local machine only (§12 Q1: not in the lockfile)
uv pip install --no-deps -e C:/Users/longt/Music/CapstoneProject_SP25AI12/SwinCoMER
uv pip install pytorch-lightning timm==1.0.29 einops editdistance torchmetrics albumentations opencv-python-headless "torchvision==<pair of torch 2.13.0>"
uv sync --dev --inexact
```

## 7. Project structure

| File | Change |
|---|---|
| `backend/app/features/hmer/recognizer.py` | explanation pass, hook capture, grid folding; `Recognition` gains `tokens`, `token_probs`, `attention` |
| `backend/app/features/hmer/schemas.py` | `AttentionMap`, new optional fields |
| `backend/app/features/hmer/router.py` | pass the new fields through |
| `tests/test_hmer.py` | new unit tests (§9) |
| `frontend/src/lib/hmerApi.ts` | types for the new fields |
| `frontend/src/lib/hmerInk.ts` + `.test.ts` | **new:** pure export layout |
| `frontend/src/components/hmer/AttentionView.tsx` + `.test.tsx` | **new:** image overlay and token strip |
| `frontend/src/components/hmer/InkCanvas.tsx` + `.test.tsx` | **new:** drawing surface and export |
| `frontend/src/pages/HmerPage.tsx` + `.test.tsx` | input tabs; wire in both components |
| `frontend/src/styles/hmer.css` | overlay, token strip, canvas |

`HmerService` needs no change: it already passes the `Recognition` through.

## 8. Code style

Match what is there. Comments explain *why*, as in `recognizer.py`. Code and comments are in English, UI copy is in Vietnamese. New frontend files are `.ts`/`.tsx`. Colours come from theme tokens, icons are inline SVG, and no new UI libraries are added. Heavy imports (`torch`) stay inside functions so importing the module stays cheap.

```python
def fold_to_image_grid(attn: "torch.Tensor", legacy: bool, cols: int) -> "torch.Tensor":
    """Collapse decoder memory positions onto the image grid.

    attn is [t, L], already averaged over heads. Returns [t, rows*cols] with
    each row summing to 1.

    Legacy checkpoints attend over (8 image columns x 768 channels), not over
    space (see §2.3 of the design spec), so the channel axis is summed away
    and only horizontal position survives. Corrected checkpoints attend over
    the 2D grid directly, row-major.
    """
    if legacy:
        attn = attn.view(attn.shape[0], cols, -1).sum(-1)
    return attn / attn.sum(-1, keepdim=True)
```

## 9. Testing strategy

**Backend (pytest).** Like the existing `tests/test_hmer.py`, these tests never import `comer`.

- `fold_to_image_grid`: legacy mass placed at `(j, c)` lands in column `j`; corrected input stays row-major; every row sums to 1.
- Hook capture on a fake decoder whose `layers[i].multihead_attn` returns `(out, attn)`: captured shapes are right, and handles are removed after both success and an exception.
- Alignment: n tokens give n rows (the EOS row is dropped), and an unknown id becomes `<unk>` without shifting anything.
- If the explanation raises, `recognize` returns the same LaTeX and score with `attention: null`.
- Router: the response carries the new fields, and the old fields are unchanged.
- **Real-model integration** is opt-in: `skipif` unless `HMER_CHECKPOINT` is set and `comer` imports. CI never runs it.

**Frontend (Vitest + React Testing Library).**

- `hmerInk` layout cases from §5.3.1.
- `AttentionView`: hovering or focusing a token sets cell opacities; arrow keys move between tokens; the columns note shows for `mode: "columns"`; the null note shows for `attention: null`; reduced motion disables playback.
- `InkCanvas`: undo and clear update state, and "Nhận dạng" is disabled when empty. Pointer events are simulated; pixels are not asserted because jsdom has no canvas rasteriser.
- `HmerPage`: switching tabs leaves the upload path working.

**In the browser.** Draw → recognise → hover tokens → playback, in the in-app browser pane. Screenshot as proof. Measure the exported image for §5.3.2.

## 10. Boundaries

- **Always:** keep recognition output identical; let explanation failures degrade to `null`; run both test suites before committing; write UI copy in Vietnamese.
- **Ask first:** any change in the capstone repository; renaming or removing any existing response field.
- **Decided, not to be reopened during implementation:** no change to `pyproject.toml` / `uv.lock` (Q1); no retraining (Q2).
- **Never:** commit checkpoints or `data.zip`; present the map as an explanation of *why* in UI copy; hard-code the grid size in the UI.

## 11. Non-goals

- Retraining a corrected checkpoint (decided against, §12 Q2).
- Hovering the KaTeX-rendered formula: KaTeX keeps no mapping back to source tokens, so hover lives on the token strip.
- A per-layer or per-head selector.
- Preprocessing uploaded photos (binarise, crop, deskew). The export logic in §5.2 could be reused for this later, but not now.
- HMER in the Docker image.
- The r2l decoder's attention.
- Pages with several expressions.

## 12. Decisions

Resolved with the user on 2026-09-23.

- **Q1. How should `comer` and its dependencies live in KiNg? → Out of the lockfile.** Install locally as in §6 and sync with `--inexact`. The alternative, an optional uv dependency group with a path source, would tie `uv.lock` to a sibling path that CI does not have. HMER is already an optional capability that works only on machines with the model, and `recognizer.py` treats its absence as a normal state, so an undeclared local install matches how the feature already behaves. `pyproject.toml` and `uv.lock` do not change.
- **Q2. Retrain a corrected checkpoint? → No. Use `ComerSwin-epoch=02-val_ExpRate=0.4713.ckpt`.** `mode: "columns"` (8 vertical bands, §2.3) is therefore the only mode users will see. The API stays grid-agnostic because that costs one branch. The `"grid"` branch is covered by unit tests only, never against a real model, and the spec says so rather than implying it was verified.
- **Q3. Keep token probabilities? → Yes**, as specified in §4.2 and §4.4.

## 13. Results

*Filled in during implementation: §3 baseline timing, S1 and S2 outcomes, §5.3.2 measurements, §5.3.3 match counts.*
