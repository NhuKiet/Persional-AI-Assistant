"""Which image format should the ink canvas export: CROHME-style or as-trained?

The canvas export was designed to look like CROHME renders (binary, cropped,
22 px strokes), because the design spec's §2.4 measured "training images" from
`data/train/image/*.bmp`. But `LatexDataset` loads the train split as `.png`
only, so those .bmp files were never trained on. The 206 877 PNGs that were
look like digital ink: thin (~3–4 px) antialiased strokes, ~8 px margin.

This recognizes held-out handwriting in both formats through a running backend:
  as_trained  the original PNG from `data/test/image` (a split never used in
              training or validation: LitCoMER tests only on CROHME 2014/16/19).
  crohme_22   the same ink as the current canvas export would render it:
              cropped to the ink, scaled so strokes are 22 px (longer side
              capped at 2200), binarised.

Usage:
  PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe tools/hmer_format_ab.py \
      --n 100 --out docs/superpowers/plans/assets/2026-09-24-format-ab.json
"""
from __future__ import annotations

import argparse
import io
import json
import random
import sys
import time
import zipfile
from pathlib import Path

import httpx
import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hmer_canvas_ab import DATA_ZIP, recognize, token_distance  # noqa: E402
from hmer_ink_check import stroke_width  # noqa: E402

TRAIN_STROKE_PX = 22
MAX_EXPORT_PX = 2200


def crohme_style(image: Image.Image) -> Image.Image:
    """What frontend/src/lib/hmerInk.ts + renderInkImage would produce."""
    gray = image.convert("L")
    ink = np.array(gray) < 128
    ys, xs = np.where(ink)
    cropped = gray.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    scale = min(TRAIN_STROKE_PX / stroke_width(ink), MAX_EXPORT_PX / max(cropped.size))
    size = (max(1, round(cropped.width * scale)), max(1, round(cropped.height * scale)))
    big = np.array(cropped.resize(size, Image.Resampling.LANCZOS))
    return Image.fromarray(np.where(big < 128, 0, 255).astype(np.uint8))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--n", type=int, default=100)
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    archive = zipfile.ZipFile(DATA_ZIP)
    lines = archive.read("data/test/caption.txt").decode("utf-8").splitlines()
    captions = sorted(line.split("\t", 1) for line in lines if "\t" in line)
    picked = random.Random(0).sample(captions, args.n)

    rows = []
    with httpx.Client() as client:
        for index, (name, gt) in enumerate(picked, 1):
            gt = gt.strip()
            original = Image.open(io.BytesIO(archive.read(f"data/test/image/{name}.png"))).convert("RGB")
            row = {"id": name, "gt": gt, "stroke_px": round(stroke_width(np.array(original.convert("L")) < 128), 1)}
            for arm, image in (("as_trained", original), ("crohme_22", crohme_style(original))):
                got = recognize(client, args.api, image, f"fmt-{arm}.png")
                got["exact"] = got["latex"] == gt
                got["token_distance"] = token_distance(got["latex"], gt)
                row[arm] = got
            rows.append(row)
            print(
                f"[{index}/{len(picked)}] {name}: "
                f"trained {'✓' if row['as_trained']['exact'] else '✗'} d={row['as_trained']['token_distance']}  "
                f"crohme22 {'✓' if row['crohme_22']['exact'] else '✗'} d={row['crohme_22']['token_distance']}",
                flush=True,
            )

    summary = {"n": len(rows)}
    for arm in ("as_trained", "crohme_22"):
        summary[arm] = {
            "exact": sum(r[arm]["exact"] for r in rows),
            "within_1_token": sum(r[arm]["token_distance"] <= 1 for r in rows),
            "mean_token_distance": round(float(np.mean([r[arm]["token_distance"] for r in rows])), 2),
        }
    summary["as_trained_only_exact"] = sum(r["as_trained"]["exact"] and not r["crohme_22"]["exact"] for r in rows)
    summary["crohme_22_only_exact"] = sum(r["crohme_22"]["exact"] and not r["as_trained"]["exact"] for r in rows)
    report = {"generated_at": time.strftime("%Y-%m-%d %H:%M:%S"), "summary": summary, "items": rows}
    Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
