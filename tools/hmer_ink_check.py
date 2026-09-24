"""Does an image look like the ones SwinCoMER was trained on?

The ink canvas re-renders strokes to match CROHME training images: binary,
cropped to the ink with no margin, strokes ~22 px wide (median 22, IQR 16-24,
measured on the training set). This measures those three properties for any
image, with the same stroke-width method used to measure the training set, so
an export can be checked against the numbers rather than by eye.

Design spec: docs/superpowers/specs/2026-09-23-hmer-attention-and-ink-canvas-design.md
(§2.4 for the training numbers, §5.3 for the criteria).

Usage:
  .venv/Scripts/python.exe tools/hmer_ink_check.py data/hmer/<file>.png [...]
"""
from __future__ import annotations

import argparse
import json

import numpy as np
from PIL import Image
from scipy import ndimage

# Training-set stroke width, IQR (spec §2.4).
TRAIN_STROKE_IQR = (16.0, 24.0)


def stroke_width(ink: np.ndarray) -> float:
    """Median stroke width in px: twice the distance-to-background at local
    maxima of the distance transform, i.e. along the stroke's medial axis.
    The same estimate as the training-set measurement, so they compare."""
    dt = ndimage.distance_transform_edt(ink)
    ridge = (dt == ndimage.maximum_filter(dt, size=3)) & ink
    return float(2 * np.median(dt[ridge])) if ridge.any() else 0.0


def measure(path: str) -> dict:
    gray = np.array(Image.open(path).convert("L"))
    ink = gray < 128
    if not ink.any():
        return {"path": path, "size": gray.shape[::-1], "empty": True}
    ys, xs = np.where(ink)
    height, width = gray.shape
    margins = {
        "left": int(xs.min()),
        "top": int(ys.min()),
        "right": int(width - 1 - xs.max()),
        "bottom": int(height - 1 - ys.max()),
    }
    width_px = stroke_width(ink)
    lo, hi = TRAIN_STROKE_IQR
    return {
        "path": path,
        "size": [width, height],
        "gray_levels": int(len(np.unique(gray))),
        "margins": margins,
        "stroke_width": round(width_px, 1),
        "checks": {
            "binary": len(np.unique(gray)) <= 2,
            "no_margin": max(margins.values()) <= 1,
            "stroke_in_training_iqr": lo <= width_px <= hi,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("images", nargs="+")
    args = parser.parse_args()
    for path in args.images:
        print(json.dumps(measure(path), ensure_ascii=False))


if __name__ == "__main__":
    main()
