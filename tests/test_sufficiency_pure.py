import datetime

import backend.app.features.research.sufficiency as suf
from backend.app.features.research.models import SearchResult

_DAY = 86400.0
_NOW = datetime.datetime(2026, 7, 25).timestamp()


def _src(content="nội dung", stored_days_ago=None, published=None):
    extra = {}
    if stored_days_ago is not None:
        extra["stored_at"] = _NOW - stored_days_ago * _DAY
    if published is not None:
        extra["published_at"] = published
    return SearchResult(source="web", title="t", url="u", content=content, extra=extra)


def test_tokens_keeps_vietnamese_diacritics():
    got = suf.tokens("kiến trúc mạng nơ-ron")
    assert "kiến" in got
    assert "trúc" in got


def test_tokens_drops_short_and_lowercases():
    assert suf.tokens("AI is a Big Model") == {"big", "model"}


def test_classify_freshness_volatile_english():
    assert suf.classify_freshness("YOLOv11 latest benchmark") == "volatile"


def test_classify_freshness_volatile_vietnamese():
    assert suf.classify_freshness("phiên bản mới nhất của YOLO") == "volatile"


def test_classify_freshness_stable():
    assert suf.classify_freshness("transformer là gì") == "stable"


def test_classify_freshness_volatile_beats_stable():
    assert suf.classify_freshness("YOLOv11 mới nhất là gì") == "volatile"


def test_classify_freshness_default():
    assert suf.classify_freshness("backbone FLOPs comparison") == "default"


def test_classify_freshness_current_year_is_volatile():
    now = datetime.datetime(2026, 7, 25).timestamp()
    assert suf.classify_freshness("SOTA models 2026", now=now) == "volatile"


def test_classify_freshness_last_year_is_volatile():
    now = datetime.datetime(2026, 7, 25).timestamp()
    assert suf.classify_freshness("models 2025", now=now) == "volatile"


def test_classify_freshness_old_year_is_not_volatile():
    now = datetime.datetime(2026, 7, 25).timestamp()
    assert suf.classify_freshness("models 2019", now=now) == "default"


def test_ttl_days_for_each_class():
    assert suf.ttl_days_for("volatile") == 7
    assert suf.ttl_days_for("stable") == 180
    assert suf.ttl_days_for("default") == 30


def test_evidence_age_uses_stored_at_when_no_published():
    assert suf.evidence_age_days(_src(stored_days_ago=10), _NOW) == 10


def test_evidence_age_prefers_published_over_stored():
    # Lưu hôm nay nhưng xuất bản 2 năm trước → phải tính theo ngày xuất bản.
    published = datetime.datetime(2024, 7, 25).timestamp()
    src = _src(stored_days_ago=0, published=published)
    assert suf.evidence_age_days(src, _NOW) > 700


def test_evidence_age_none_when_no_timestamp():
    assert suf.evidence_age_days(_src(), _NOW) is None


def test_is_fresh_unknown_age_allowed_when_unknown_ok():
    assert suf.is_fresh(_src(), ttl_days=30, now=_NOW, unknown_ok=True) is True


def test_is_fresh_unknown_age_rejected_when_not_unknown_ok():
    assert suf.is_fresh(_src(), ttl_days=7, now=_NOW, unknown_ok=False) is False


def test_fresh_subset_filters_by_ttl():
    fresh = _src(content="mới", stored_days_ago=3)
    old   = _src(content="cũ",  stored_days_ago=90)
    out = suf.fresh_subset([fresh, old], ttl_days=30, now=_NOW, unknown_ok=True)
    assert [s.content for s in out] == ["mới"]


def test_query_coverage_full():
    src = _src(content="transformer attention mechanism")
    assert suf.query_coverage("transformer attention", [src]) == 1.0


def test_query_coverage_partial():
    src = _src(content="transformer attention mechanism")
    # 2/4 token có mặt: transformer, attention (flops/backbone không)
    assert suf.query_coverage("transformer attention flops backbone", [src]) == 0.5


def test_query_coverage_vietnamese_diacritics():
    src = _src(content="kiến trúc mạng nơ-ron rất sâu")
    assert suf.query_coverage("kiến trúc mạng", [src]) == 1.0


def test_query_coverage_empty_sources_is_zero():
    assert suf.query_coverage("bất kỳ câu hỏi nào", []) == 0.0


def test_query_coverage_degenerate_query_is_one():
    src = _src(content="nội dung")
    assert suf.query_coverage("ai", [src]) == 1.0


def test_evidence_age_prefers_falsy_published_at_over_stored_at():
    """published_at=0.0 (epoch) is a legitimate but falsy value — must still
    take precedence over stored_at, not be treated as absent."""
    src = _src(stored_days_ago=1, published=0.0)
    # published_at=0.0 → age tính từ epoch (1970-01-01), phải lớn hơn nhiều so với 1 ngày
    assert suf.evidence_age_days(src, _NOW) > 1


def test_assess_empty_when_no_candidates():
    state, fresh = suf.assess("bất kỳ", [], now=_NOW)
    assert state == suf.EMPTY
    assert fresh == []


def test_assess_stale_when_all_expired():
    old = _src(content="transformer attention", stored_days_ago=400)
    state, fresh = suf.assess("transformer attention", [old], now=_NOW)
    assert state == suf.STALE
    assert fresh == []


def test_assess_thin_when_coverage_low():
    src = _src(content="transformer attention", stored_days_ago=1)
    state, fresh = suf.assess(
        "transformer attention flops backbone chi tiết", [src], now=_NOW
    )
    assert state == suf.THIN
    assert len(fresh) == 1


def test_assess_maybe_when_fresh_and_covered():
    src = _src(content="transformer attention mechanism", stored_days_ago=1)
    state, fresh = suf.assess("transformer attention", [src], now=_NOW)
    assert state == suf.MAYBE
    assert len(fresh) == 1


def test_assess_coverage_uses_fresh_subset_only():
    """Một nguồn mới nhưng lạc đề không được kéo cả tập cũ thành 'còn tươi'."""
    fresh_irrelevant = _src(content="chủ đề hoàn toàn khác", stored_days_ago=1)
    old_relevant     = _src(content="transformer attention", stored_days_ago=400)
    state, fresh = suf.assess(
        "transformer attention", [fresh_irrelevant, old_relevant], now=_NOW
    )
    assert state == suf.THIN
    assert len(fresh) == 1


def test_assess_missing_timestamp_volatile_is_stale():
    src = _src(content="YOLOv11 mới nhất")
    state, fresh = suf.assess("YOLOv11 mới nhất", [src], now=_NOW)
    assert state == suf.STALE


def test_assess_missing_timestamp_stable_reaches_maybe():
    src = _src(content="transformer là gì và kiến trúc của nó")
    state, fresh = suf.assess("transformer là gì", [src], now=_NOW)
    assert state == suf.MAYBE


def test_assess_year_only_published_rounds_to_january_first():
    """publishedYear chỉ có độ chính xác theo năm → quy về 1/1 (mốc già nhất)."""
    jan_first_2026 = datetime.datetime(2026, 1, 1).timestamp()
    src = _src(content="transformer attention", published=jan_first_2026)
    # 25/07/2026 - 01/01/2026 = 205 ngày > TTL default 30 → hết hạn
    state, _ = suf.assess("transformer attention", [src], now=_NOW)
    assert state == suf.STALE
