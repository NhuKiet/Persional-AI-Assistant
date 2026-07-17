from backend.app.features.research.models import SearchResult
from backend.app.features.research.search.ranking import (
    recency_score, citation_score, rerank_results,
)


class _FakeReranker:
    """compute_score trả điểm cố định theo thứ tự đầu vào."""
    def __init__(self, scores): self._scores = scores
    def compute_score(self, pairs, normalize=True): return self._scores


def test_recency_score_newer_is_higher():
    assert recency_score({"year": 2024}) > recency_score({"year": 2000})


def test_recency_score_missing_or_bad_year_is_zero():
    assert recency_score({}) == 0.0
    assert recency_score({"year": "n/a"}) == 0.0


def test_recency_score_uses_published_when_no_year():
    assert recency_score({"published": "2023-05-01"}) > 0.0


def test_citation_score_caps_at_one():
    assert citation_score({"citation_count": 5000}) == 1.0
    assert citation_score({"citation_count": 100}) == 0.5
    assert citation_score({}) == 0.0


def test_fallback_still_prefers_recent(monkeypatch):
    """Refactor fallback KHÔNG đổi hành vi: nhánh fallback (reranker None) vẫn ưu tiên mới hơn."""
    import backend.app.features.research.search.ranking as ranking
    monkeypatch.setattr(ranking, "_get_reranker", lambda: None)
    old = SearchResult(source="web", title="old", url="u1", content="c", score=0.5, extra={"year": 2000})
    new = SearchResult(source="web", title="new", url="u2", content="c", score=0.5, extra={"year": 2024})
    ranked = rerank_results("q", [old, new], top_k=2)
    assert ranked[0].title == "new"


def test_bge_path_prefers_more_recent_when_rerank_ties(monkeypatch):
    import backend.app.features.research.search.ranking as ranking
    monkeypatch.setattr(ranking, "_get_reranker", lambda: _FakeReranker([0.8, 0.8]))
    old = SearchResult(source="web", title="old", url="u1", content="c", score=0.5, extra={"year": 2000})
    new = SearchResult(source="web", title="new", url="u2", content="c", score=0.5, extra={"year": 2024})
    ranked = rerank_results("q", [old, new], top_k=2)
    assert ranked[0].title == "new"


def test_bge_path_prefers_more_cited_when_rerank_ties(monkeypatch):
    import backend.app.features.research.search.ranking as ranking
    monkeypatch.setattr(ranking, "_get_reranker", lambda: _FakeReranker([0.8, 0.8]))
    low = SearchResult(source="arxiv", title="low", url="u1", content="c", score=0.5, extra={"citation_count": 0})
    high = SearchResult(source="arxiv", title="high", url="u2", content="c", score=0.5, extra={"citation_count": 400})
    ranked = rerank_results("q", [low, high], top_k=2)
    assert ranked[0].title == "high"


def test_bge_path_preserves_relevance_when_signals_absent(monkeypatch):
    """Khi recency/citation = 0 cho cả hai, thứ tự theo rerank (top-1 relevance không tụt)."""
    import backend.app.features.research.search.ranking as ranking
    monkeypatch.setattr(ranking, "_get_reranker", lambda: _FakeReranker([0.3, 0.9]))
    a = SearchResult(source="web", title="less_relevant", url="u1", content="c", score=0.5, extra={})
    b = SearchResult(source="web", title="more_relevant", url="u2", content="c", score=0.5, extra={})
    ranked = rerank_results("q", [a, b], top_k=2)
    assert ranked[0].title == "more_relevant"
