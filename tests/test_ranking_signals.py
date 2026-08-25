import datetime

from backend.app.features.research.models import SearchResult
from backend.app.features.research.search.ranking import (
    recency_score, citation_score, rerank_results,
)


def test_recency_score_newer_is_higher():
    assert recency_score({"year": 2024}) > recency_score({"year": 2000})


def test_recency_score_defaults_to_dynamic_current_year(monkeypatch):
    """No ref_year given → uses datetime.now(timezone.utc).year, not a value
    hardcoded at write-time. A source published in the current year must
    score 1.0 (age 0), regardless of what "current year" actually is."""
    import backend.app.features.research.search.ranking as ranking

    class _FixedDatetime(ranking.datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2031, 3, 1, tzinfo=tz)

    monkeypatch.setattr(ranking, "datetime", _FixedDatetime)

    assert recency_score({"year": 2031}) == 1.0
    assert recency_score({"year": 2030}) < 1.0


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
    """Refactor fallback KHÔNG đổi hành vi: nhánh fallback (rerank None) vẫn ưu tiên mới hơn."""
    import backend.app.features.research.search.ranking as ranking
    monkeypatch.setattr(ranking, "cross_encoder_scores", lambda q, docs: None)
    old = SearchResult(source="web", title="old", url="u1", content="c", score=0.5, extra={"year": 2000})
    new = SearchResult(source="web", title="new", url="u2", content="c", score=0.5, extra={"year": 2024})
    ranked = rerank_results("q", [old, new], top_k=2)
    assert ranked[0].title == "new"


def test_bge_path_prefers_more_recent_when_rerank_ties(monkeypatch):
    import backend.app.features.research.search.ranking as ranking
    monkeypatch.setattr(ranking, "cross_encoder_scores", lambda q, docs: [0.8, 0.8])
    old = SearchResult(source="web", title="old", url="u1", content="c", score=0.5, extra={"year": 2000})
    new = SearchResult(source="web", title="new", url="u2", content="c", score=0.5, extra={"year": 2024})
    ranked = rerank_results("q", [old, new], top_k=2)
    assert ranked[0].title == "new"


def test_bge_path_prefers_more_cited_when_rerank_ties(monkeypatch):
    import backend.app.features.research.search.ranking as ranking
    monkeypatch.setattr(ranking, "cross_encoder_scores", lambda q, docs: [0.8, 0.8])
    low = SearchResult(source="arxiv", title="low", url="u1", content="c", score=0.5, extra={"citation_count": 0})
    high = SearchResult(source="arxiv", title="high", url="u2", content="c", score=0.5, extra={"citation_count": 400})
    ranked = rerank_results("q", [low, high], top_k=2)
    assert ranked[0].title == "high"


def test_bge_path_preserves_relevance_when_signals_absent(monkeypatch):
    """Khi recency/citation = 0 cho cả hai, thứ tự theo rerank (top-1 relevance không tụt)."""
    import backend.app.features.research.search.ranking as ranking
    monkeypatch.setattr(ranking, "cross_encoder_scores", lambda q, docs: [0.3, 0.9])
    a = SearchResult(source="web", title="less_relevant", url="u1", content="c", score=0.5, extra={})
    b = SearchResult(source="web", title="more_relevant", url="u2", content="c", score=0.5, extra={})
    ranked = rerank_results("q", [a, b], top_k=2)
    assert ranked[0].title == "more_relevant"


def test_bge_path_large_rerank_gap_dominates_max_rival_signals(monkeypatch):
    """Rerank gap 0.70 (> ~0.62 threshold) must win even against a rival loaded
    with max recency/citation/credibility.

    final_a = 0.90*0.55 + 0.55*0.20 + 0*0.10 + 0*0.10 + 0.5*0.05 = 0.63
    final_b = 0.20*0.55 + 1.00*0.20 + 1*0.10 + 1*0.10 + 0.5*0.05 = 0.535
    => a (0.63) beats b (0.535).
    """
    import backend.app.features.research.search.ranking as ranking
    monkeypatch.setattr(ranking, "cross_encoder_scores", lambda q, docs: [0.90, 0.20])
    a = SearchResult(source="web", title="high_rerank", url="u1", content="c", score=0.5, extra={})
    b = SearchResult(
        source="arxiv", title="max_signals", url="u2", content="c", score=0.5,
        extra={"year": 2025, "citation_count": 1000},
    )
    ranked = rerank_results("q", [a, b], top_k=2)
    assert ranked[0].title == "high_rerank"


def test_bge_path_small_rerank_gap_flipped_by_strong_signals(monkeypatch):
    """Small rerank gap (0.10) is legitimately overturned by strong recency/
    citation/credibility on the lower-rerank item — ranking is not rerank-only.

    final_a = 0.50*0.55 + 1.00*0.20 + 1*0.10 + 1*0.10 + 0.5*0.05 = 0.70
    final_b = 0.60*0.55 + 0.55*0.20 + 0*0.10 + 0*0.10 + 0.5*0.05 = 0.465
    => a (0.70) beats b (0.465) despite b's higher raw rerank score.
    """
    import backend.app.features.research.search.ranking as ranking
    monkeypatch.setattr(ranking, "cross_encoder_scores", lambda q, docs: [0.50, 0.60])
    a = SearchResult(
        source="arxiv", title="high_signal", url="u1", content="c", score=0.5,
        extra={"year": 2025, "citation_count": 1000},
    )
    b = SearchResult(source="web", title="high_rerank_only", url="u2", content="c", score=0.5, extra={})
    ranked = rerank_results("q", [a, b], top_k=2)
    assert ranked[0].title == "high_signal"


def test_recency_score_reads_published_at_epoch():
    now_year = datetime.datetime.now(datetime.timezone.utc).year
    epoch = datetime.datetime(now_year, 1, 1, tzinfo=datetime.timezone.utc).timestamp()
    assert recency_score({"published_at": epoch}) > 0.9


def test_recency_score_published_at_does_not_override_explicit_year():
    old = datetime.datetime(2000, 1, 1, tzinfo=datetime.timezone.utc).timestamp()
    assert recency_score({"year": datetime.datetime.now().year, "published_at": old}) > 0.9


def test_recency_score_still_zero_without_any_date():
    assert recency_score({}) == 0.0
