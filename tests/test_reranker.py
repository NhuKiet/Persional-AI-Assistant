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
