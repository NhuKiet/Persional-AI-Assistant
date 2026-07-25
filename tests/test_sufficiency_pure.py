import datetime

import backend.app.features.research.sufficiency as suf


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
