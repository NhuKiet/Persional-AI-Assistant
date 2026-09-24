"""Does re-rendering drawn ink like the training data actually help?

The ink canvas does not send what the pad shows. It re-renders the strokes to
look like CROHME training images — binary, cropped to the ink, 22 px strokes —
instead of the pad's thin antialiased strokes floating in a wide margin. That
is extra code, and this checks it earns its place (design spec §5.3, criterion
3: the normalised export must get at least as many exact matches as a raw one).

Two arms, carrying the same ink:
  normalised  the training-format image.
  raw         the same ink as the pad shows it: scaled so strokes are the pen's
              on-screen width in device pixels, antialiased, centred on a
              pad-sized white canvas.

The raw arm is derived from the normalised image rather than captured from a
browser, so the two arms differ only in format, never in what was drawn. It is
the *generous* raw export: white background. A naive `canvas.toDataURL()` of
the pad is transparent, which the backend's `convert("L")` turns black.

Ink sources:
  --crohme N        N random CROHME 2019 test expressions, with ground truth.
                    Their images already have the training format.
  --image PATH=GT   canvas exports (already normalised) with a ground truth
                    you supply, e.g. drawings made in the app.

Recognition goes through a running backend (--api), so no second copy of the
model competes for the 4 GB GPU. Every image uploaded is deleted afterwards.

Usage:
  PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe tools/hmer_canvas_ab.py \
      --crohme 100 --image "data/hmer/x_ve-tay.png=2 x + 4 = 7" \
      --out docs/superpowers/plans/assets/2026-09-24-canvas-ab.json
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
from hmer_ink_check import stroke_width  # noqa: E402

DATA_ZIP = r"C:/Users/longt/Downloads/CoMER/data.zip"

# The pad as measured in the app on this machine: 852×220 CSS px at
# devicePixelRatio 1.25, pen PEN_PX = 4 CSS px.
PAD_DEVICE_PX = (1065, 275)
PEN_DEVICE_PX = 4 * 1.25


def rawify(image: Image.Image) -> tuple[Image.Image, float]:
    """The same ink as the pad would show it. Returns the image and how much
    the ink had to shrink beyond pen width to fit the pad (1.0 = not at all)."""
    gray = image.convert("L")
    scale = PEN_DEVICE_PX / stroke_width(np.array(gray) < 128)
    w, h = gray.width * scale, gray.height * scale
    # Ink that would not fit the pad is ink the user would have drawn smaller.
    fit = min(1.0, 0.95 * PAD_DEVICE_PX[0] / w, 0.95 * PAD_DEVICE_PX[1] / h)
    size = (max(1, round(w * fit)), max(1, round(h * fit)))
    small = gray.resize(size, Image.Resampling.LANCZOS)
    pad = Image.new("L", PAD_DEVICE_PX, 255)
    pad.paste(small, ((PAD_DEVICE_PX[0] - size[0]) // 2, (PAD_DEVICE_PX[1] - size[1]) // 2))
    return pad, fit


def token_distance(a: str, b: str) -> int:
    """Levenshtein distance over LaTeX tokens (the model emits them
    space-separated), the unit CROHME error tolerances are counted in."""
    x, y = a.split(), b.split()
    row = list(range(len(y) + 1))
    for i, tx in enumerate(x, 1):
        prev, row[0] = row[0], i
        for j, ty in enumerate(y, 1):
            prev, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, prev + (tx != ty))
    return row[-1]


def recognize(client: httpx.Client, api: str, image: Image.Image, name: str) -> dict:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    response = client.post(
        f"{api}/api/hmer/recognize",
        files={"file": (name, buffer.getvalue(), "image/png")},
        timeout=300,
    )
    response.raise_for_status()
    body = response.json()
    client.delete(f"{api}/api/hmer/images/{body['filename']}")
    return {"latex": body["latex"], "score": round(body["score"], 4), "elapsed_ms": body["elapsed_ms"]}


def crohme_items(n: int) -> list[tuple[str, Image.Image, str]]:
    archive = zipfile.ZipFile(DATA_ZIP)
    lines = archive.read("data/2019/caption.txt").decode("utf-8").splitlines()
    captions = sorted(line.split("\t", 1) for line in lines if "\t" in line)
    items = []
    for name, gt in random.Random(0).sample(captions, n):
        image = Image.open(io.BytesIO(archive.read(f"data/2019/img/{name}.bmp")))
        items.append((f"crohme/{name}", image.copy(), gt.strip()))
    return items


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--crohme", type=int, default=0)
    parser.add_argument("--image", action="append", default=[], metavar="PATH=GT")
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    items = crohme_items(args.crohme) if args.crohme else []
    for spec in args.image:
        path, gt = spec.split("=", 1)
        items.append((f"app/{Path(path).name}", Image.open(path).copy(), gt.strip()))

    results = []
    with httpx.Client() as client:
        for index, (item_id, image, gt) in enumerate(items, 1):
            raw_image, fit = rawify(image)
            row = {"id": item_id, "gt": gt, "raw_fit": round(fit, 3)}
            for arm, arm_image in (("normalised", image), ("raw", raw_image)):
                got = recognize(client, args.api, arm_image, f"ab-{arm}.png")
                got["exact"] = got["latex"] == gt
                got["token_distance"] = token_distance(got["latex"], gt)
                row[arm] = got
            results.append(row)
            print(
                f"[{index}/{len(items)}] {item_id}: "
                f"norm {'✓' if row['normalised']['exact'] else '✗'} d={row['normalised']['token_distance']}  "
                f"raw {'✓' if row['raw']['exact'] else '✗'} d={row['raw']['token_distance']}",
                flush=True,
            )

    def summarise(rows: list[dict]) -> dict:
        out = {"n": len(rows)}
        for arm in ("normalised", "raw"):
            out[arm] = {
                "exact": sum(r[arm]["exact"] for r in rows),
                "within_1_token": sum(r[arm]["token_distance"] <= 1 for r in rows),
                "mean_token_distance": round(float(np.mean([r[arm]["token_distance"] for r in rows])), 2) if rows else None,
            }
        out["normalised_only_exact"] = sum(r["normalised"]["exact"] and not r["raw"]["exact"] for r in rows)
        out["raw_only_exact"] = sum(r["raw"]["exact"] and not r["normalised"]["exact"] for r in rows)
        return out

    report = {
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "pad_device_px": PAD_DEVICE_PX,
        "pen_device_px": PEN_DEVICE_PX,
        "summary": {
            "crohme": summarise([r for r in results if r["id"].startswith("crohme/")]),
            "app": summarise([r for r in results if r["id"].startswith("app/")]),
        },
        "items": results,
    }
    Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(report["summary"], ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
