"""Does the occlusion evidence map follow the ink, on the real model?

The gate before any evidence UI (design spec §4.5.1, plan T8). The attention
map this replaced passed a naive progression check while ignoring the image
(§13.4), so every check here has a control that a content-blind map fails:

  progression  On single-line expressions, symbol tokens' evidence centres
               move rightward in reading order. Mean Spearman rho >= 0.8.
  shift        Pad the left with background as wide as the image, so the ink
               moves into the right half. A token at x must move to
               0.5 + x/2. Shift ratio = observed shift / that ideal shift,
               averaged: 1.0 moves exactly with the ink, 0 stays put (which
               is what attention did). Must be >= 0.7.
  blank        On a blank image every token is flagged no-evidence.
  latency      Explaining the 27-token capstone sample takes < 5 s.

It also reports the distribution of per-token total drops, symbol vs
structural tokens, to check where MIN_TOTAL_DROP sits.

Runs HmerRecognizer.explain in-process (the same code the endpoint runs).

Usage:
  PYTHONPATH=. PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe tools/hmer_evidence_check.py \
      --out docs/superpowers/plans/assets/2026-09-24-evidence-check.json
"""
from __future__ import annotations

import argparse
import io
import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.stats import spearmanr

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))
from hmer_attention_spike import STRUCTURAL, pick_samples  # noqa: E402

from backend.app.features.hmer import occlusion  # noqa: E402
from backend.app.features.hmer.recognizer import HmerRecognizer  # noqa: E402

SAMPLE = r"C:/Users/longt/Music/CapstoneProject_SP25AI12/SwinCoMER/example/UN19_1041_em_595.bmp"
SAMPLE_GT = r"x ^ { 2 } = \sum \limits _ { a = 1 } ^ { 3 } x _ { a } ^ { 2 }"


def png(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def centres(explanation) -> list[float | None]:
    """Evidence centre along x (0–1) per token; None when flagged."""
    cols = explanation.cols
    xs = (np.arange(cols) + 0.5) / cols
    out = []
    for weights, flagged in zip(explanation.weights, explanation.no_evidence):
        if flagged:
            out.append(None)
            continue
        column_mass = np.array(weights).reshape(explanation.rows, cols).sum(0)
        out.append(float((column_mass * xs).sum()))
    return out


def total_drops(recognizer: HmerRecognizer, image_bytes: bytes, tokens: list[str]) -> list[float]:
    """Raw per-token total drop (nats), before normalisation — to see where
    MIN_TOTAL_DROP sits. Same pieces explain() uses."""
    import torch

    ids = [recognizer._vocab.word2idx[t] for t in tokens]
    device = next(recognizer._model.parameters()).device
    img = recognizer._to_tensor(image_bytes).to(device)
    with torch.no_grad():
        lp0 = recognizer._token_log_probs(img, ids)[0]
        cells = occlusion.occlusion_batch(img, occlusion.ROWS, occlusion.COLS, occlusion.background_value(img))
        lp_cells = torch.cat([recognizer._token_log_probs(c, ids) for c in torch.split(cells, occlusion.EXPLAIN_BATCH)])
    return (lp0[None, :] - lp_cells).clamp(min=0).sum(0).cpu().tolist()


def shifted(image: Image.Image) -> Image.Image:
    background = int(np.median(np.array(image.convert("L"))))
    out = Image.new("RGB", (image.width * 2, image.height), (background,) * 3)
    out.paste(image, (image.width, 0))
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--n", type=int, default=5)
    parser.add_argument("--image", action="append", default=[], metavar="PATH=GT")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    recognizer = HmerRecognizer()
    recognizer.ensure_loaded()

    samples = pick_samples(args.n, set(recognizer._vocab.word2idx))
    for spec in args.image:
        path, gt = spec.split("=", 1)
        samples.append((f"app/{Path(path).name}", Image.open(path).convert("RGB"), gt.split()))

    rows = []
    symbol_drops, structural_drops = [], []
    for sample_id, image, tokens in samples:
        symbols = [i for i, t in enumerate(tokens) if t not in STRUCTURAL]
        original = recognizer.explain(png(image), tokens)
        moved = recognizer.explain(png(shifted(image)), tokens)
        blank = recognizer.explain(png(Image.new("RGB", image.size, (250, 250, 250))), tokens)

        x0, x1 = centres(original), centres(moved)
        pairs = [(i, x0[i], x1[i]) for i in symbols if x0[i] is not None and x1[i] is not None]
        rho = spearmanr(range(len(pairs)), [a for _, a, _ in pairs]).statistic if len(pairs) >= 3 else float("nan")
        ideal = np.array([0.5 - a / 2 for _, a, _ in pairs])
        observed = np.array([b - a for _, a, b in pairs])
        shift_ratio = float(observed.mean() / ideal.mean()) if len(pairs) else float("nan")

        drops = total_drops(recognizer, png(image), tokens)
        for i, d in enumerate(drops):
            (structural_drops if tokens[i] in STRUCTURAL else symbol_drops).append(d)

        row = {
            "id": sample_id,
            "tokens": tokens,
            "p_mean": round(float(np.mean(original.token_probs)), 3),
            "rho": round(float(rho), 3),
            "shift_ratio": round(shift_ratio, 3),
            "symbols_with_evidence": f"{len(pairs)}/{len(symbols)}",
            "blank_all_flagged": all(blank.no_evidence),
            "centres": [None if c is None else round(c, 3) for c in x0],
            "centres_shifted": [None if c is None else round(c, 3) for c in x1],
            "total_drops": [round(d, 3) for d in drops],
            "elapsed_ms": original.elapsed_ms,
        }
        rows.append(row)
        print(f"{sample_id:40s} p={row['p_mean']:.2f} rho={row['rho']:+.2f} shift_ratio={row['shift_ratio']:.2f} "
              f"evidence {row['symbols_with_evidence']} blank_flagged={row['blank_all_flagged']} {row['elapsed_ms']} ms")

    # Latency on the capstone sample, warm (the first explain above paid for loading).
    sample_bytes = Path(SAMPLE).read_bytes()
    latencies = []
    for _ in range(3):
        t0 = time.perf_counter()
        recognizer.explain(sample_bytes, SAMPLE_GT.split())
        latencies.append(time.perf_counter() - t0)

    # The single-line samples have no structural tokens by construction; the
    # capstone sample has plenty ({ } ^ _ \limits), so it feeds that side of
    # the MIN_TOTAL_DROP distribution.
    sample_tokens = SAMPLE_GT.split()
    for token, d in zip(sample_tokens, total_drops(recognizer, sample_bytes, sample_tokens)):
        (structural_drops if token in STRUCTURAL else symbol_drops).append(d)

    train = [r for r in rows if r["id"].startswith("train/")]

    def q(values):
        if not values:
            return None
        return [round(float(np.percentile(values, p)), 3) for p in (10, 25, 50, 75, 90)]
    summary = {
        "mean_rho_train": round(float(np.nanmean([r["rho"] for r in train])), 3),
        "mean_shift_ratio_train": round(float(np.nanmean([r["shift_ratio"] for r in train])), 3),
        "blank_all_flagged": all(r["blank_all_flagged"] for r in rows),
        "sample_latency_s": [round(t, 2) for t in latencies],
        "total_drop_quantiles_symbol_p10_25_50_75_90": q(symbol_drops),
        "total_drop_quantiles_structural_p10_25_50_75_90": q(structural_drops),
        "min_total_drop": occlusion.MIN_TOTAL_DROP,
    }
    summary["gate"] = {
        "progression_rho_ge_0.8": summary["mean_rho_train"] >= 0.8,
        "shift_ratio_ge_0.7": summary["mean_shift_ratio_train"] >= 0.7,
        "blank_all_flagged": summary["blank_all_flagged"],
        "latency_lt_5s": max(latencies) < 5.0,
    }
    print(json.dumps(summary, indent=1))
    Path(args.out).write_text(json.dumps({"summary": summary, "items": rows}, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
