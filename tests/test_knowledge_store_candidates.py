import datetime
import time

from backend.app.features.research.knowledge_store import _Hit, _rank_candidates

_DAY = 86400.0
_NOW = datetime.datetime(2026, 7, 25).timestamp()


def _hit(score, days_old=0, published_at=0.0, published_year=0, content="nội dung",
         timestamp_known=True):
    return _Hit(
        parent_id=content, parent_content=content, source="web", title="t",
        url="u", score=score, timestamp=_NOW - days_old * _DAY,
        published_at=published_at, published_year=published_year,
        timestamp_known=timestamp_known,
    )


def test_old_but_relevant_survives_raw_threshold():
    """Điểm thô vượt ngưỡng thì tuổi tác KHÔNG được loại — TTL là việc của
    tầng sufficiency. Đây chính là xung đột time-decay mà spec 5.1 nêu."""
    out = _rank_candidates([_hit(0.9, days_old=400)], threshold=0.65, now=_NOW)
    assert len(out) == 1


def test_low_raw_score_is_filtered():
    assert _rank_candidates([_hit(0.2)], threshold=0.65, now=_NOW) == []


def test_decay_orders_but_does_not_eliminate():
    fresh = _hit(0.70, days_old=1,   content="mới")
    old   = _hit(0.75, days_old=300, content="cũ")
    out = _rank_candidates([fresh, old], threshold=0.65, now=_NOW)
    assert len(out) == 2
    assert out[0].content == "mới"      # decay đẩy 'cũ' xuống, không xoá


def test_stored_at_is_carried_into_extra():
    out = _rank_candidates([_hit(0.9, days_old=10)], threshold=0.65, now=_NOW)
    assert out[0].extra["stored_at"] == _NOW - 10 * _DAY


def test_published_at_carried_when_known():
    pub = datetime.datetime(2024, 3, 15).timestamp()
    out = _rank_candidates([_hit(0.9, published_at=pub)], threshold=0.65, now=_NOW)
    assert out[0].extra["published_at"] == pub


def test_published_year_resolves_to_january_first():
    out = _rank_candidates([_hit(0.9, published_year=2023)], threshold=0.65, now=_NOW)
    assert out[0].extra["published_at"] == datetime.datetime(2023, 1, 1).timestamp()


def test_no_published_metadata_leaves_key_absent():
    out = _rank_candidates([_hit(0.9, days_old=5)], threshold=0.65, now=_NOW)
    assert "published_at" not in out[0].extra


def test_unknown_timestamp_leaves_stored_at_absent():
    """Chunk thiếu property `timestamp` thật sự trong Weaviate KHÔNG được
    coi là 'vừa lưu bây giờ' — nếu không, quy tắc bất đối xứng volatile+
    unknown-timestamp→STALE (spec §12.1) không bao giờ được kích hoạt trên
    dữ liệu thật, vì mọi chunk đều trông 'mới toanh'."""
    out = _rank_candidates(
        [_hit(0.9, timestamp_known=False)], threshold=0.65, now=_NOW,
    )
    assert "stored_at" not in out[0].extra


def test_known_zero_age_timestamp_still_carried():
    """Ngược lại: timestamp thật sự = now (chunk mới lưu tích tắc trước) vẫn
    phải được mang theo — chỉ khi THỰC SỰ thiếu property mới bỏ qua."""
    out = _rank_candidates([_hit(0.9, days_old=0)], threshold=0.65, now=_NOW)
    assert out[0].extra["stored_at"] == _NOW


def test_duplicate_parents_keep_best_score():
    out = _rank_candidates(
        [_hit(0.70, content="same"), _hit(0.95, content="same")],
        threshold=0.65, now=_NOW,
    )
    assert len(out) == 1
    assert out[0].score == 0.95
