from backend.app.features.research.models import SearchResult
from backend.app.features.research.search.ranking import (
    recency_score, citation_score, rerank_results,
)


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
