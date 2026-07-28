from datetime import datetime, timezone

from backend.app.features.news.models import NewsItem
from backend.app.features.news.schemas import NewsItemOut, NewsListResponse, RefreshResponse, Topic


def test_topic_enum_has_exactly_the_four_spec_values():
    assert {t.value for t in Topic} == {"model_release", "research", "robotics", "community"}


def test_news_item_out_from_news_item_round_trips_fields():
    item = NewsItem(
        url="https://example.com/a", title="T", description_raw="D",
        source="Src", topic="robotics",
        published_at=datetime(2026, 7, 27, tzinfo=timezone.utc),
        fetched_at=datetime(2026, 7, 28, tzinfo=timezone.utc),
        title_vi="TV", summary_vi="SV",
    )
    out = NewsItemOut.from_news_item(item)
    assert out.url == "https://example.com/a"
    assert out.title_vi == "TV"
    assert out.summary_vi == "SV"
    assert out.topic == "robotics"
    assert out.published_at == item.published_at


def test_news_item_out_serializes_timestamps_as_iso8601():
    item = NewsItem(
        url="https://example.com/a", title="T", description_raw="D",
        source="Src", topic="research", published_at=None,
        fetched_at=datetime(2026, 7, 28, 10, 0, 0, tzinfo=timezone.utc),
        title_vi="TV", summary_vi="SV",
    )
    out = NewsItemOut.from_news_item(item)
    payload = out.model_dump(mode="json")
    assert payload["fetched_at"] == "2026-07-28T10:00:00Z" or payload["fetched_at"].startswith("2026-07-28T10:00:00")
    assert payload["published_at"] is None


def test_news_list_response_shape():
    resp = NewsListResponse(items=[], limit=20, offset=0, has_more=False)
    assert resp.model_dump() == {"items": [], "limit": 20, "offset": 0, "has_more": False}


def test_refresh_response_shape():
    assert RefreshResponse(new_count=5).model_dump() == {"new_count": 5}
