"""Occlusion maths for the HMER evidence map, without the model.

The map is only as honest as these pieces: a cell mask that leaks into its
neighbour smears evidence across symbols, and a normalised near-zero drop
paints noise as a confident region. Both are checked here on plain tensors.
"""
import pytest
import torch

from backend.app.features.hmer.occlusion import (
    background_value,
    cell_bounds,
    evidence,
    occlusion_batch,
)

FILL = -1.0  # never produced by torch.rand, so every filled pixel is identifiable


def _cell_mask(h, w, rows, cols, k):
    r, q = divmod(k, cols)
    y0, y1 = cell_bounds(h, rows)[r]
    x0, x1 = cell_bounds(w, cols)[q]
    mask = torch.zeros(h, w, dtype=torch.bool)
    mask[y0:y1, x0:x1] = True
    return mask


# ── Cells ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize(("size", "parts"), [(256, 4), (256, 16), (10, 3), (7, 4), (5, 5)])
def test_cells_tile_the_axis_without_gaps_or_overlaps(size, parts):
    bounds = cell_bounds(size, parts)

    assert len(bounds) == parts
    assert bounds[0][0] == 0 and bounds[-1][1] == size
    assert all(a[1] == b[0] for a, b in zip(bounds, bounds[1:]))
    assert all(end > start for start, end in bounds)


@pytest.mark.parametrize(("h", "w", "rows", "cols"), [(256, 256, 4, 16), (10, 7, 3, 4)])
def test_each_copy_differs_from_the_input_in_exactly_its_own_cell(h, w, rows, cols):
    img = torch.rand(1, 3, h, w)

    batch = occlusion_batch(img, rows, cols, FILL)

    assert batch.shape == (rows * cols, 3, h, w)
    for k in range(rows * cols):
        changed = (batch[k] != img[0]).any(0)
        assert torch.equal(changed, _cell_mask(h, w, rows, cols, k)), f"cell {k}"
        assert torch.all(batch[k][:, changed] == FILL)


def test_cells_are_row_major():
    img = torch.rand(1, 1, 8, 8)

    batch = occlusion_batch(img, 2, 4, FILL)

    # Cell 5 is row 1, column 1: the second quarter of the bottom half.
    assert torch.all(batch[5, 0, 4:8, 2:4] == FILL)
    assert not torch.any(batch[5, 0, :4] == FILL)


def test_the_input_is_not_modified():
    img = torch.rand(1, 3, 16, 16)
    before = img.clone()

    occlusion_batch(img, 4, 4, FILL)

    assert torch.equal(img, before)


def test_background_is_the_median_so_ink_does_not_move_it():
    img = torch.full((1, 3, 20, 20), 250.0)
    img[:, :, 5:8, :] = 30.0  # 15 % ink, as dark as a pen stroke

    assert background_value(img) == 250.0


# ── Evidence ────────────────────────────────────────────────────────────

def test_evidence_rows_sum_to_one_and_follow_the_drops():
    lp0 = torch.tensor([-0.1, -0.2])
    # 3 cells × 2 tokens: hiding cell 0 hurts token 0, cell 2 hurts token 1.
    lp_cells = torch.tensor([[-2.1, -0.2], [-0.6, -0.4], [-0.1, -3.2]])

    weights, flagged = evidence(lp0, lp_cells, min_total=0.05)

    assert weights.shape == (2, 3)
    assert torch.allclose(weights.sum(-1), torch.ones(2))
    assert torch.allclose(weights[0], torch.tensor([2.0, 0.5, 0.0]) / 2.5)
    assert weights[1].argmax() == 2
    assert not flagged.any()


def test_hiding_a_cell_that_makes_the_model_surer_is_not_evidence():
    lp0 = torch.tensor([-1.0])
    lp_cells = torch.tensor([[-0.2], [-2.0]])  # cell 0 raises the log-prob

    weights, _ = evidence(lp0, lp_cells, min_total=0.05)

    assert weights[0, 0] == 0
    assert weights[0, 1] == 1


def test_a_token_no_single_cell_carries_is_flagged_not_normalised():
    """Normalising a 0.01-nat total would paint noise as a confident map."""
    lp0 = torch.tensor([-0.5, -0.5])
    lp_cells = torch.tensor([[-0.505, -1.5], [-0.51, -0.5]])  # token 0 drops 0.015 in total

    weights, flagged = evidence(lp0, lp_cells, min_total=0.05)

    assert flagged.tolist() == [True, False]
    assert torch.all(weights[0] == 0)
    assert weights[1].sum() == pytest.approx(1.0)
