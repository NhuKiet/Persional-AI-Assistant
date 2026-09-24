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

> **Correction (2026-09-24, §13.5).** The table below measured `data/train/image/*.bmp`, the CROHME renders. Those are **not** what the model trained on: `LatexDataset` loads the train split as `.png` only. The 206 877 PNGs it did train on are digital ink: RGB, antialiased, strokes 2.8–4 px, margins ~8 px, median 800 × 375 (aspect 2.34). A held-out A/B then showed the model reads the canvas's CROHME-style export as well as the as-trained format (36 vs 35 exact of 100). What matters is that the ink fills the frame, not stroke width or binarisation, so §5.2 stands. The table is kept because the canvas export targets it and the CROHME 2014/16/19 test sets use this format.

Random samples from the CROHME `.bmp` images in `data.zip`'s `train/` (see the correction above):

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

1. **Install `comer` without its declared dependencies.** `setup.py` feeds `requirements.txt` into `install_requires`. That file pins `matplotlib==3.5.1` (KiNg pins 3.10.8) and `einops==0.3.0`, and it includes dev tools (flake8, black, jupyter). Install with `--no-deps`, and with the build constraint `setuptools<81` because `setup.py` imports `pkg_resources`. Then install the runtime imports explicitly.
2. **Runtime imports:** pytorch-lightning, timm, einops, torchmetrics, torchvision, albumentations, opencv (headless). `from comer.datamodule import vocab` runs `datamodule.py → dataset.py → transforms.py`, which imports `cv2` and `albumentations` at module level. So cv2 is needed even though KiNg never trains. `editdistance` is **not** needed: it has no cp313 Windows wheel, so the capstone repo now imports it lazily inside `on_test_epoch_end`, the only place that uses it (decision D1b, §12).
3. **Pin timm to 1.0.29**, the version in the capstone venv. The legacy path hands the backbone tensor unchanged to `Conv2d(in=8)`, which only works when timm emits NHWC. A timm that emits NCHW breaks the legacy checkpoint on its first forward pass.
4. **Torch comes from the lockfile.** On Windows that is now `2.14.0+cu126` (decision D1a, §12). Install `torchvision==0.29.0` from the same cu126 index with `--no-deps`, so it matches torch exactly and cannot pull a different torch.
5. **Stop `uv sync` from removing it.** `uv sync` removes packages that are not in `uv.lock` by default. Because `comer` stays out of the lockfile (§12 Q1), local setup always uses `uv sync --dev --inexact`. A plain `uv sync --dev` silently uninstalls HMER, which `/api/hmer/status` then reports as the missing-package error.
6. **Configure `.env`:** `HMER_CHECKPOINT=C:/Users/longt/Downloads/CoMER/checkpoints/ComerSwin-epoch=02-val_ExpRate=0.4713.ckpt`.

Known and unchanged: the first load downloads timm ImageNet weights and then overwrites them (NOTE in `recognizer.py`), so the first load needs network access.

**Success criteria**

1. After one recognition, `GET /api/hmer/status` reports `loaded: true` and `last_error: null`.
2. The sample image's output matches its CROHME 2019 ground truth in `data.zip` (`data/2019/caption.txt`). Not `example.ipynb`: that notebook runs the upstream DenseNet CoMER (`comer.lit_comer`, the 0.6365 checkpoint), not SwinCoMER.
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
uv sync --dev --inexact
echo "setuptools<81" > /tmp/hmer-build.txt
uv pip install --no-deps --build-constraint /tmp/hmer-build.txt -e C:/Users/longt/Music/CapstoneProject_SP25AI12/SwinCoMER
uv pip install pytorch-lightning timm==1.0.29 einops torchmetrics albumentations opencv-python-headless
uv pip install --no-deps --index-url https://download.pytorch.org/whl/cu126 torchvision==0.29.0
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
- **Decided, not to be reopened during implementation:** `comer` stays out of `uv.lock` (Q1); the Windows torch source is the only lockfile change (D1a); no retraining (Q2).
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

Resolved at plan checkpoint D1, after measuring 415 s per image on CPU (§13.1):

- **D1a. GPU on the Windows host → CUDA torch through the lockfile.** `pyproject.toml` gains a `sys_platform == 'win32'` source for torch on the cu126 index (driver 560.94 supports at most CUDA 12.6), and `uv.lock` is regenerated. uv resolved Windows torch to `2.14.0+cu126`. Linux (CI, Docker) keeps `2.4.1+cu121`, and macOS keeps `2.13.0` from PyPI. This is the only lockfile change in this work; `comer` itself stays out of it (Q1). A manual `uv pip install` of CUDA torch was rejected because the next sync would put the locked CPU build back. Side effect: on Windows the BGE reranker also runs on the GPU and shares the 4 GB with HMER.
- **D1b. `editdistance` → lazy import in the capstone repo.** One import moves from the top of `comer/lit_comer_swin.py` into `on_test_epoch_end`. The owner commits it in that repo. KiNg carries no workaround.

## 13. Results

*Filled in during implementation: §3 baseline timing, S1 and S2 outcomes, §5.3.2 measurements, §5.3.3 match counts.*

### 13.1 Runtime baseline on CPU (T1, 2026-09-23)

Real `HmerRecognizer`, `device="cpu"`, torch `2.13.0+cpu`, sample `UN19_1041_em_595.bmp` (249×144):

| Measure | Value |
|---|---|
| Checkpoint load (includes timm pretrained download) | 34.9 s |
| First recognition | 445.2 s |
| Warm recognition | 415.3 s |
| Encoder mode | legacy (`legacy_hw_as_channels = True`), beam size 8 |
| Output | `x ^ { 2 } = \sum \limits _ { a = 1 } ^ { 3 } x _ { a } ^ { 2 }` — **matches ground truth**; score −0.1907 |

The runtime is correct but, at about 7 minutes per image, far over D1's 30 s threshold.

Two findings from installing into KiNg's venv:

- **KiNg's venv is CPython 3.13**, and the capstone venv is 3.11. `editdistance` has no cp313 Windows wheel, and building it needs a C++ compiler. `comer/lit_comer_swin.py` imports it at module top, although only `on_test_epoch_end` uses it (test metrics). The measurement above stubbed it in a throwaway script.
- `comer`'s `setup.py` imports `pkg_resources`, which recent setuptools no longer ships. The editable install needs a build constraint `setuptools<81`.

### 13.2 Runtime on GPU after D1a/D1b (T1, 2026-09-23)

torch `2.14.0+cu126`, torchvision `0.29.0+cu126`, timm `1.0.29`, RTX 3050 Ti Laptop (4 GB). No `editdistance` stub: `editdistance` is never imported, so D1b holds.

| Measure | Direct `HmerRecognizer` | `POST /api/hmer/recognize` (port 8001) |
|---|---|---|
| Load | 30.9 s | included in first request |
| First recognition | 6.00 s | 14.0 s wall (with load) |
| Warm recognition | 5.48 s, 5.29 s | 7.0 s wall (`elapsed_ms` 5804–6781) |
| Peak VRAM (HMER alone) | 1235 MiB | — |
| Output | identical to CPU: same LaTeX, score −0.1907, **matches ground truth** | same; `/api/hmer/status` → `loaded: true`, `device: cuda`, `last_error: null` |

About 75× faster than CPU.

**D1a's side effect, measured 2026-09-24: both models do not fit on the 4 GB card.** The reranker is loaded at boot by `reranker_selfcheck`, not lazily as assumed above, and on CUDA torch it goes to the GPU: 3016 MiB used before HMER loads, 3908/4096 after. Windows does not raise out-of-memory. It pages VRAM out to system RAM, and two recognitions of the sample hit the 180 s and 60 s client timeouts without completing. Fix: a new `RERANKER_DEVICE` setting (`auto`/`cuda`/`cpu`, default `auto`, so Docker and Linux are unchanged), set to `cpu` in this machine's `.env`. That restores the reranker's pre-D1a placement. With it, the reranker logs "loaded on CPU", recognition takes **4.7 s** with a ground-truth match, and GPU use sits at 354 MiB between requests.

### 13.3 Canvas export, measured (T4, 2026-09-24)

**Format (§5.3 criterion 2).** Measured with `tools/hmer_ink_check.py` (§2.4 method) on five real exports: the owner's four mouse drawings and one pointer-event polyline.

| Export | Size | Grey levels | Margins L/T/R/B | Stroke |
|---|---|---|---|---|
| `2x+4=7` (mouse) | 2200 × 435 | 2 | 0/0/0/0 | 16.0 px |
| `7a+3=8` (mouse) | 2200 × 493 | 2 | 0/0/0/0 | 16.0 px |
| `7a+3=4` (mouse) | 2200 × 528 | 2 | 0/0/0/0 | 16.0 px |
| `7a+3=6` (mouse) | 2200 × 490 | 2 | 0/0/0/0 | 16.0 px |
| `x+1` (polyline, T3) | 913 × 391 | 2 | 0/0/0/1 | 22.0 px |

All pass. All four mouse drawings hit the 2200 px cap: the owner wrote ~550 CSS px wide and ~120 px tall, about half the pad rather than the hinted third, so the uniform shrink put strokes at 16 px, the bottom of the training IQR. They are also wide: aspect 4.2–5.1 against a training median of 2.25.

**Does normalising earn its place (§5.3 criterion 3)?** `tools/hmer_canvas_ab.py` recognizes the same ink in two formats through the running backend: *normalised* (training format) and *raw* (the same ink as the pad shows it: strokes scaled to the pen's 5 device px, antialiased, centred on the 1065 × 275 device-px pad, white background — the generous version of a raw export). Instead of the ten fixed §5.4 expressions, the sources were 100 random CROHME 2019 test expressions with ground truth, plus the owner's four drawings with ground truth read from the images. Full results: `docs/superpowers/plans/assets/2026-09-24-canvas-ab.json`.

| Ink | n | Normalised exact | Raw exact | Normalised mean token distance | Raw mean token distance |
|---|---|---|---|---|---|
| CROHME 2019 test | 100 | **50** | **0** | 3.86 | 24.69 |
| Owner's mouse drawings | 4 | 3 | 4 | 0.25 | 0.00 |

- **CROHME: raw fails completely.** CROHME ink scaled to pen width sits at about the hinted third of the pad, and the model cannot read it. It falls back to outputs it memorized: the 2×2 identity matrix 33 times, a `z^{z^{z…}}` tower 27 times, a binomial 16 times, whatever the input. Normalised gets 50/100, in line with the checkpoint's validation ExpRate of 0.47.
- **Owner's drawings: raw 4/4, normalised 3/4.** Raw can read them because the owner filled half the pad. The one difference is `7 a + 3 = 8`, which normalised read as `7 w + 3 = 8` (score −1.41).
- **Is the normalised miss a stroke-width problem? No.** Thickening the four normalised exports by dilation made things worse: at 22 px the miss became `7 _ { w } + 3 = 8`; at 28 px every drawing broke, one into a zero matrix. The 16 px export was the best of the three. So the miss is not caused by the export, and at n=4 one flip is noise.

**Verdict.** Criterion 3 as literally written, normalised ≥ raw on drawn expressions, fails on the owner's four drawings by one item. The evidence says the export is right anyway. Raw works only when the user happens to fill the pad, and collapses to memorized outputs otherwise. Normalised is independent of where and how large the ink sits, matches the model's measured accuracy on real handwriting, and the one drawn miss is not fixed by any stroke width. Keep §5.2 as designed. Also recorded: the model is sensitive to stroke width *above* the training range (28 px broke all four drawings), which supports capping at the training median rather than growing strokes with writing size.

### 13.4 Spikes S1/S2: the legacy attention does not look at the image (T5, 2026-09-24)

`tools/hmer_attention_spike.py`, CPU, teacher forcing on ground truth. Five single-line training expressions (PNG, aspect ≥ 3) and two of the owner's drawings, each under three conditions with the same tokens: the image, the image mirrored, and a blank image. Results: `docs/superpowers/plans/assets/2026-09-24-attention-spike.{json,png}`.

**S1 passes as written, and that pass means nothing.** Every layer shows a left-to-right progression; layers 1–3 and the mean have Spearman ρ ≈ 1.00 on every sample. But the controls show the same progression:

| Mean ρ over the 5 training samples | layer0 | layer1 | layer2 | layer3 | mean |
|---|---|---|---|---|---|
| image | 0.63 | 1.00 | 0.98 | 1.00 | 1.00 |
| mirrored | 0.28 | 1.00 | 0.96 | 1.00 | 1.00 |
| blank | 0.46 | 1.00 | 0.93 | 0.99 | 0.98 |

Mean total-variation distance between a token's map on the image and on the mirrored image is 0.024 in layer 1. That is smaller than the distance between two *different* real images at the same step (0.062). Meanwhile token probabilities do react to the pixels (the owner's `7a+3=6`: 0.92 on the image, 0.00 mirrored, 0.01 blank), so the model reads the ink through the values it attends to, not through *where* it attends. The column distribution tracks the decoder step and is content-independent. Every layer's first and last token centres land in the same places whatever the image (layer 3: 2.2 → 4.8 of 0–7 on all samples).

**Translation control, attention vs occlusion.** A probe (`assets/2026-09-24-occlusion-probe.json`, script kept out of the repo) moved the ink into the right half by padding the left with background, and compared the attention centres with **occlusion sensitivity**: hide one cell of a 4 × 16 grid at a time, and record how much each token's log-probability drops.

| `1 ≤ j < l ≤ n`, token centre x (0–1) | original | ink shifted right |
|---|---|---|
| occlusion | 0.06, 0.17, 0.28, 0.43, 0.50, 0.70, 0.91 | 0.64–0.90 — moves with the ink |
| attention (layer 1) | 0.45 → 0.54 | 0.47 → 0.54 — does not move |

All four samples behave the same way. Occlusion spans the ink and follows it; attention does not.

**Occlusion cost on GPU** (64 cells, 26-token sample): 2.1 s at batch 16 (peak 1271 MiB), 3.0 s at batch 8 (747 MiB). Batch 32 took 33 s (2319 MiB): VRAM paging again (§13.2).

**Gate outcome: stop before T6.** An attention overlay built on this checkpoint would sweep left to right over any input, blank or mirrored included. It would be a demo that misleads, and the first mirrored upload would expose it. The options are for the owner to decide.

### 13.5 Export format vs the real training format (2026-09-24)

While picking T5 samples, `data/train/image` turned out to hold 206 877 `.png` and 8 834 `.bmp`, and the dataset code reads only the `.png`. §2.4 had measured the `.bmp`. Measured on 200 of the PNGs: RGB, 211 grey levels, margins ~8 px, strokes 2.8/4.0/4.0 px (quartiles), 800 × 375 median. That is digital ink, blue on off-white.

`tools/hmer_format_ab.py` took 100 held-out handwritten expressions (`data/test`, never used for training or validation) and recognized each in two formats through the backend. *as_trained* is the original PNG. *crohme_22* is the same ink as the canvas export renders it: cropped, strokes 22 px (capped at 2200 px), binarised. Results: `docs/superpowers/plans/assets/2026-09-24-format-ab.json`.

| n = 100 | Exact | Within 1 token | Mean token distance |
|---|---|---|---|
| as_trained | 35 | 45 | 4.1 |
| crohme_22 (current export) | 36 | 43 | 4.5 |

Only 15 of 100 differ at all in token distance (9 favour as_trained, 6 favour crohme_22), and 1 vs 2 are exact in one arm only. No meaningful difference, so the export does not need redoing. Together with §13.3, where the same ink failed 100/100 once it was small inside a large margin, this says the property that matters is that **the ink fills the frame**. Stroke width, binarisation and colour barely matter within this range.

Suite on the new torch: 598 passed, 17 skipped, the same as the baseline. Two HMER tests had read the developer's `.env` (`checkpoint=None` means "use settings", not "unconfigured"); they now clear the setting explicitly, with assertions unchanged.
