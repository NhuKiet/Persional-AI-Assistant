import types

import backend.app.features.research.reranker as rr


def test_credibility_for_known_and_default():
    assert rr.credibility_for("arxiv") == 1.0
    assert rr.credibility_for("web") == 0.55
    assert rr.credibility_for("unknown-src") == 0.5


def test_fuse_scores_with_rerank():
    out = rr.fuse_scores([0.9, 0.1], base=[0.5, 0.5], cred=[1.0, 0.4])
    # 0.9*0.7 + 1.0*0.2 + 0.5*0.1 = 0.88 ; 0.1*0.7 + 0.4*0.2 + 0.5*0.1 = 0.20
    assert abs(out[0] - 0.88) < 1e-9
    assert abs(out[1] - 0.20) < 1e-9


def test_fuse_scores_without_rerank():
    out = rr.fuse_scores(None, base=[0.6, 0.2], cred=[1.0, 0.5])
    # 0.6*0.7 + 1.0*0.3 = 0.72 ; 0.2*0.7 + 0.5*0.3 = 0.29
    assert abs(out[0] - 0.72) < 1e-9
    assert abs(out[1] - 0.29) < 1e-9


def test_cross_encoder_prefers_cohere(monkeypatch):
    monkeypatch.setattr(rr, "_cohere_scores", lambda q, d: [0.5, 0.6])
    monkeypatch.setattr(rr, "_bge_scores", lambda q, d: [0.0, 0.0])
    assert rr.cross_encoder_scores("q", ["a", "b"]) == [0.5, 0.6]


def test_cross_encoder_falls_back_to_bge(monkeypatch):
    monkeypatch.setattr(rr, "_cohere_scores", lambda q, d: None)
    monkeypatch.setattr(rr, "_bge_scores", lambda q, d: [0.3, 0.4])
    assert rr.cross_encoder_scores("q", ["a", "b"]) == [0.3, 0.4]


def test_cross_encoder_none_when_no_backend(monkeypatch):
    monkeypatch.setattr(rr, "_cohere_scores", lambda q, d: None)
    monkeypatch.setattr(rr, "_bge_scores", lambda q, d: None)
    assert rr.cross_encoder_scores("q", ["a"]) is None


def test_cross_encoder_empty_docs():
    assert rr.cross_encoder_scores("q", []) is None


def test_cohere_remap_reorders_shuffled_results():
    # cohere returns results sorted by relevance (index 1 first), not input order
    fake_results = [
        types.SimpleNamespace(index=1, relevance_score=0.9),
        types.SimpleNamespace(index=0, relevance_score=0.2),
    ]
    out = rr._cohere_remap(fake_results, n=2)
    # remapped back to input order: doc0 -> 0.2, doc1 -> 0.9
    assert out == [0.2, 0.9]


def test_fuse_scores_three_signal_weights():
    assert rr.fuse_scores(rerank=[1.0], base=[1.0], cred=[1.0]) == [1.0]
    assert abs(rr.fuse_scores(rerank=[1.0], base=[0.0], cred=[0.0])[0] - 0.7) < 1e-9


def test_fuse_scores_five_signal_weights():
    out = rr.fuse_scores(rerank=[1.0], base=[1.0], cred=[1.0], recency=[1.0], citation=[1.0])
    assert abs(out[0] - 1.0) < 1e-9
    out = rr.fuse_scores(rerank=[1.0], base=[0.0], cred=[0.0], recency=[0.0], citation=[0.0])
    assert abs(out[0] - 0.55) < 1e-9


def test_fuse_scores_five_signal_without_reranker():
    out = rr.fuse_scores(rerank=None, base=[1.0], cred=[1.0], recency=[1.0], citation=[1.0])
    assert abs(out[0] - 1.0) < 1e-9


def test_fuse_scores_monotonic_in_rerank():
    assert rr.fuse_scores([0.9], [0.5], [0.5])[0] > rr.fuse_scores([0.1], [0.5], [0.5])[0]


# ── Regression: the reranker that loaded but could not score ─────────────────
# FlagEmbedding 1.4.0 called `prepare_for_model`, removed from transformers 5.x
# slow tokenizers. The model loaded fine, so every health signal looked green,
# and only `compute_score` raised — swallowed as "fall back to credibility".
# Cross-encoder reranking was therefore dead for an unknown period with no
# symptom. These pin the two behaviours that let that hide.

def test_bge_scores_returns_none_instead_of_raising(monkeypatch):
    """A scoring failure must degrade, never propagate into the pipeline."""
    import types

    monkeypatch.setattr(rr, "_bge_reranker", lambda: types.SimpleNamespace(
        predict=_raise_runtime_error
    ))
    assert rr._bge_scores("q", ["d1", "d2"]) is None


def _raise_runtime_error(pairs):
    raise RuntimeError("XLMRobertaTokenizer has no attribute prepare_for_model")


def test_selfcheck_reports_a_model_that_loads_but_cannot_score(monkeypatch):
    """Loading is not evidence of working — the exact shape of the outage."""
    import types

    monkeypatch.setattr(rr, "_bge_reranker", lambda: types.SimpleNamespace(
        predict=_raise_runtime_error
    ))
    problem = rr.reranker_selfcheck()
    assert problem is not None
    assert "prepare_for_model" in problem


def test_selfcheck_passes_on_a_working_reranker(monkeypatch):
    import types

    monkeypatch.setattr(rr, "_bge_reranker", lambda: types.SimpleNamespace(
        predict=lambda pairs: [0.5] * len(pairs)
    ))
    assert rr.reranker_selfcheck() is None


def test_selfcheck_reports_a_missing_model(monkeypatch):
    monkeypatch.setattr(rr, "_bge_reranker", lambda: None)
    assert rr.reranker_selfcheck() == "reranker model unavailable"


def test_bge_scores_are_clamped_into_unit_range(monkeypatch):
    """fuse_scores weights assume [0, 1]; a stray value outside it would let
    one document outrank every other regardless of the other signals."""
    import types

    monkeypatch.setattr(rr, "_bge_reranker", lambda: types.SimpleNamespace(
        predict=lambda pairs: [1.4, -0.3, 0.62]
    ))
    assert rr._bge_scores("q", ["a", "b", "c"]) == [1.0, 0.0, 0.62]
