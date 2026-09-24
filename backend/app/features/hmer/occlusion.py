"""Occlusion sensitivity: which regions of the image each LaTeX token rests on.

Hide one cell of a grid at a time, redo the teacher-forced pass, and see how
much less sure the model becomes of each token. This replaced a cross-attention
map: on the only usable checkpoint, attention sweeps left to right with the
decoding step whatever the image — mirrored and blank inputs included — while
occlusion moves with the ink (design spec
docs/superpowers/specs/2026-09-23-hmer-attention-and-ink-canvas-design.md,
§4 and §13.4).

Tensor code only. Loading and running the model stays in recognizer.py, so
this can be tested without the checkpoint or the `comer` package.
"""
from __future__ import annotations

__all__ = [
    "COLS",
    "EXPLAIN_BATCH",
    "MIN_TOTAL_DROP",
    "ROWS",
    "background_value",
    "cell_bounds",
    "evidence",
    "occlusion_batch",
]

# Expressions are wide (training median aspect 2.34, drawings 4–5), so columns
# need finer resolution than rows: 16 is about one symbol each in a 10–15
# symbol expression; 4 rows separate baseline, scripts and fraction parts.
ROWS = 4
COLS = 16

# Occluded passes per forward call. 8 peaked at 747 MiB on the 4 GB card;
# 32 crossed into Windows VRAM paging and took 11× longer (spec §13.4).
EXPLAIN_BATCH = 8

# Below this total log-probability drop (nats) no single cell carries the
# token — typical for `{`, `}`, whose evidence is spread or implied — and its
# normalised weights would be noise drawn as a confident map.
MIN_TOTAL_DROP = 0.05


def cell_bounds(size: int, parts: int) -> list[tuple[int, int]]:
    """Split [0, size) into `parts` contiguous ranges that tile it exactly.

    Integer division rather than a fixed cell width, so sizes that do not
    divide evenly leave neither a gap nor an overlap at the edge.
    """
    return [(i * size // parts, (i + 1) * size // parts) for i in range(parts)]


def background_value(img) -> float:
    """The paper's value: the median pixel of the first channel.

    Ink is a small fraction of any expression image, so the median is the
    background whatever the ink colour — and filling a hidden cell with it
    makes the cell look empty rather than dark.
    """
    return float(img[0, 0].median())


def occlusion_batch(img, rows: int, cols: int, fill: float):
    """One copy of `img` ([1, C, H, W]) per cell, row-major, with that cell
    filled. Returns [rows*cols, C, H, W]; the input is left untouched."""
    _, _, height, width = img.shape
    batch = img.repeat(rows * cols, 1, 1, 1)
    for r, (y0, y1) in enumerate(cell_bounds(height, rows)):
        for c, (x0, x1) in enumerate(cell_bounds(width, cols)):
            batch[r * cols + c, :, y0:y1, x0:x1] = fill
    return batch


def evidence(lp0, lp_cells, min_total: float):
    """Per-token evidence weights from occlusion.

    lp0 is [tokens], the baseline log-probability of each token; lp_cells is
    [cells, tokens], the same with one cell hidden. A drop means hiding that
    cell made the model less sure; a rise is clamped away, since "hiding this
    helped" is not evidence the token rests on that region.

    Tokens whose total drop is below min_total get all-zero weights and a
    flag: no single cell carries them, and normalising a near-zero vector
    would paint noise as a confident map.

    Returns (weights [tokens, cells], flagged [tokens]).
    """
    import torch

    drop = (lp0[None, :] - lp_cells).clamp(min=0).T
    total = drop.sum(-1, keepdim=True)
    flagged = total.squeeze(-1) < min_total
    weights = torch.where(flagged[:, None], torch.zeros_like(drop), drop / total.clamp(min=1e-12))
    return weights, flagged
