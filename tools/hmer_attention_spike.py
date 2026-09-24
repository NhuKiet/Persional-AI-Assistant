"""Does the legacy checkpoint's cross-attention carry any left-to-right signal?

Spikes S1 and S2 of the design spec (§4.1), run before any attention UI:

  S1  In legacy mode the decoder attends over 8 × 768 memory positions. Reading
      the encoder code says axis 0 is image *columns* (§2.3); nothing has
      checked it. If it is, then on single-line expressions each token's
      attention centre should move rightward as the expression is read.
  S2  Which aggregation shows that best: one of the 4 decoder layers (each
      averaged over its 8 heads) or their mean?

Teacher forcing on the *ground-truth* tokens: one forward pass per image (fast
on CPU, so no second model copy on the GPU), and a misread cannot confound the
check. Samples are single-line expressions (no fractions, scripts or roots),
wide ones, from the PNG training images the model actually learned from.

Measures, per layer:
  rho   Spearman correlation between a symbol's position in the expression and
        its attention centre (column index weighted by attention mass).
        Structural tokens ({ } ^ _ …) are excluded: they have no ink.
  peak  mean of each token's largest column mass. 0.125 = uniform = no signal.

Usage:
  PYTHONPATH=. PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe tools/hmer_attention_spike.py \
      --out docs/superpowers/plans/assets/2026-09-24-attention-spike.json \
      --figure docs/superpowers/plans/assets/2026-09-24-attention-spike.png
"""
from __future__ import annotations

import argparse
import io
import json
import random
import sys
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps
from scipy.stats import spearmanr

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))
from hmer_canvas_ab import DATA_ZIP  # noqa: E402

from backend.app.core.config import settings  # noqa: E402
from backend.app.features.hmer.recognizer import HmerRecognizer  # noqa: E402

STRUCTURAL = {"{", "}", "^", "_", "\\frac", "\\sqrt", "\\limits", "\\left", "\\right", "&", "\\\\"}


def pick_samples(n: int, known: set[str]) -> list[tuple[str, Image.Image, list[str]]]:
    archive = zipfile.ZipFile(DATA_ZIP)
    lines = archive.read("data/train/caption.txt").decode("utf-8").splitlines()
    candidates = []
    for line in lines:
        if "\t" not in line:
            continue
        name, caption = line.split("\t", 1)
        tokens = caption.split()
        # Some captions carry tokens the checkpoint's vocabulary lacks
        # (`zp`, `dz`); teacher forcing cannot feed those.
        if 7 <= len(tokens) <= 14 and not set(tokens) & STRUCTURAL and set(tokens) <= known:
            candidates.append((name.strip(), tokens))
    random.Random(0).shuffle(candidates)
    picked = []
    for name, tokens in candidates:
        try:
            image = Image.open(io.BytesIO(archive.read(f"data/train/image/{name}.png"))).convert("RGB")
        except KeyError:
            continue
        if image.width / image.height >= 3:
            picked.append((f"train/{name}", image, tokens))
        if len(picked) == n:
            break
    return picked


def attention_per_layer(recognizer: HmerRecognizer, image: Image.Image, tokens: list[str]):
    """Teacher-forced pass; returns ([layer][token] column distributions, token probs)."""
    import torch

    model, vocab = recognizer._model, recognizer._vocab
    unknown = [t for t in tokens if t not in vocab.word2idx]
    if unknown:
        raise ValueError(f"tokens not in vocabulary: {unknown}")
    ids = [vocab.word2idx[t] for t in tokens]

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    img = recognizer._to_tensor(buffer.getvalue())

    captured = []
    layers = model.comer_model.decoder.model.layers
    handles = [
        layer.multihead_attn.register_forward_hook(lambda _m, _i, out: captured.append(out[1].detach()))
        for layer in layers
    ]
    try:
        with torch.no_grad():
            feature, mask = model.comer_model.encoder(img, torch.zeros(img.shape[0], *img.shape[2:], dtype=torch.bool))
            tgt = torch.tensor([[vocab.SOS_IDX] + ids])
            logits = model.comer_model.decoder(feature, mask, tgt)
    finally:
        for handle in handles:
            handle.remove()

    grid_h, grid_w = feature.shape[1], feature.shape[2]
    legacy = model.comer_model.encoder.legacy_hw_as_channels
    maps = []
    for attn in captured:                       # [heads, n+1, L]
        a = attn.mean(0)[:-1]                   # heads averaged, EOS row dropped → [n, L]
        a = a.view(a.shape[0], grid_h, grid_w)
        # Legacy: axis 0 is (hypothesised) image columns, axis 1 feature
        # channels; summing channels leaves a distribution over columns.
        cols = a.sum(-1) if legacy else a.sum(1)
        cols = cols / cols.sum(-1, keepdim=True)
        maps.append(cols.numpy())
    probs = logits[0, :-1].softmax(-1).gather(-1, torch.tensor(ids)[:, None]).squeeze(-1).numpy()
    return maps, probs, legacy


def score(maps: list[np.ndarray], tokens: list[str]) -> dict:
    symbol_idx = [i for i, t in enumerate(tokens) if t not in STRUCTURAL]
    cols = np.arange(maps[0].shape[1])
    variants = {f"layer{i}": m for i, m in enumerate(maps)}
    variants["mean"] = np.mean(maps, axis=0)
    out = {}
    for name, m in variants.items():
        centre = (m * cols).sum(-1)
        rho = spearmanr(range(len(symbol_idx)), centre[symbol_idx]).statistic
        out[name] = {
            "rho": round(float(rho), 3),
            "peak": round(float(m.max(-1).mean()), 3),
            "first_centre": round(float(centre[symbol_idx[0]]), 2),
            "last_centre": round(float(centre[symbol_idx[-1]]), 2),
            "centres": [round(float(c), 2) for c in centre],
        }
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--n", type=int, default=5)
    parser.add_argument("--image", action="append", default=[], metavar="PATH=GT")
    parser.add_argument("--checkpoint", default=settings.HMER_CHECKPOINT)
    parser.add_argument("--out", required=True)
    parser.add_argument("--figure")
    args = parser.parse_args()

    recognizer = HmerRecognizer(checkpoint=args.checkpoint, device="cpu")
    recognizer.ensure_loaded()

    samples = pick_samples(args.n, set(recognizer._vocab.word2idx))
    for spec in args.image:
        path, gt = spec.split("=", 1)
        samples.append((f"app/{Path(path).name}", Image.open(path).convert("RGB"), gt.split()))

    # Controls, same tokens, different pixels. If the maps follow the ink,
    # mirroring the image must reverse the progression (rho < 0) and a blank
    # image must give none. If rho stays positive on both, the "progression"
    # is the decoder sweeping with its step count, not reading the image.
    conditions = {
        "image": lambda im: im,
        "mirrored": ImageOps.mirror,
        "blank": lambda im: Image.new("RGB", im.size, (250, 250, 250)),
    }

    results = []
    for sample_id, image, tokens in samples:
        row = {"id": sample_id, "tokens": tokens}
        print(f"\n{sample_id}  ({' '.join(tokens)})")
        for condition, transform in conditions.items():
            maps, probs, legacy = attention_per_layer(recognizer, transform(image), tokens)
            row[condition] = {"legacy": legacy, "token_probs": [round(float(p), 3) for p in probs],
                              "layers": score(maps, tokens), "maps": [m.round(3).tolist() for m in maps]}
            line = "  ".join(f"{name}:{s['rho']:+.2f}" for name, s in row[condition]["layers"].items())
            print(f"  {condition:8s} p={np.mean(probs):.2f}  rho {line}")
        results.append(row)

    summary = {}
    train_rows = [r for r in results if r["id"].startswith("train/")]
    for condition in conditions:
        summary[condition] = {}
        for name in results[0]["image"]["layers"]:
            layer_scores = [r[condition]["layers"][name] for r in train_rows]
            summary[condition][name] = {
                "mean_rho_train": round(float(np.mean([s["rho"] for s in layer_scores])), 3),
                "first_left_of_last_train": sum(s["first_centre"] < s["last_centre"] for s in layer_scores),
                "mean_peak_train": round(float(np.mean([s["peak"] for s in layer_scores])), 3),
            }
    print("\nsummary:", json.dumps(summary, indent=1))
    Path(args.out).write_text(json.dumps({"summary": summary, "items": results}, ensure_ascii=False, indent=1), encoding="utf-8")

    if args.figure:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        best = max(summary["image"], key=lambda k: summary["image"][k]["mean_rho_train"])
        pick = (lambda maps: np.mean(maps, axis=0)) if best == "mean" else (lambda maps: np.array(maps[int(best[5:])]))
        fig, axes = plt.subplots(len(results), 4, figsize=(16, 2.6 * len(results)),
                                 gridspec_kw={"width_ratios": [1.4, 1, 1, 1]}, squeeze=False)
        for ax_row, (sample_id, image, tokens), row in zip(axes, samples, results):
            ax_row[0].imshow(image)
            ax_row[0].set_title(sample_id, fontsize=8)
            ax_row[0].axis("off")
            for ax, condition in zip(ax_row[1:], conditions):
                m = pick(row[condition]["maps"])
                ax.imshow(m, aspect="auto", cmap="magma", vmin=0)
                ax.set_yticks(range(len(tokens)), tokens, fontsize=7)
                ax.set_xticks(range(m.shape[1]))
                ax.set_title(f"{condition} ({best})", fontsize=8)
        fig.tight_layout()
        fig.savefig(args.figure, dpi=110)
        print("figure:", args.figure)


if __name__ == "__main__":
    main()
