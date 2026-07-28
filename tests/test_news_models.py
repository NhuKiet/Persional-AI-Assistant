from datetime import datetime, timezone

from backend.app.features.news.models import NewsItem, RefreshResult, normalize_url


def test_normalize_url_strips_fragment():
    assert normalize_url("https://example.com/a?x=1#section") == "https://example.com/a?x=1"


def test_normalize_url_strips_tracking_params_but_keeps_others():
    result = normalize_url("https://example.com/a?utm_source=rss&ref=blog&id=42")
    assert result == "https://example.com/a?id=42"


def test_normalize_url_lowercases_host():
    assert normalize_url("https://Example.COM/a") == "https://example.com/a"


def test_normalize_url_strips_trailing_slash_when_path_only():
    assert normalize_url("https://example.com/a/") == "https://example.com/a"


def test_normalize_url_keeps_trailing_slash_when_query_present():
    assert normalize_url("https://example.com/a/?id=1") == "https://example.com/a/?id=1"


def test_normalize_url_two_tracking_variants_of_same_article_collapse():
    a = normalize_url("https://example.com/post?utm_source=twitter")
    b = normalize_url("https://example.com/post?utm_source=newsletter&utm_campaign=x")
    assert a == b == "https://example.com/post"


def test_normalize_url_rejects_empty_and_schemeless():
    assert normalize_url("") == ""
    assert normalize_url("not a url") == ""


def test_news_item_defaults_vi_fields_empty():
    item = NewsItem(
        url="https://example.com/a", title="Title", description_raw="Desc",
        source="Test Source", topic="research",
        published_at=datetime(2026, 7, 1, tzinfo=timezone.utc),
        fetched_at=datetime(2026, 7, 28, tzinfo=timezone.utc),
    )
    assert item.title_vi == ""
    assert item.summary_vi == ""


def test_refresh_result_holds_new_count():
    assert RefreshResult(new_count=5).new_count == 5
