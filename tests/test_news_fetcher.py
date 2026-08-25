import asyncio
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime

import httpx
import pytest

from backend.app.core.config import settings
from backend.app.features.news import fetcher


_RSS_TEMPLATE = """<?xml version="1.0"?>
<rss version="2.0"><channel>
{items}
</channel></rss>"""

_ITEM_TEMPLATE = """<item>
  <title>{title}</title>
  <link>{link}</link>
  <description>{description}</description>
  <pubDate>{pubdate}</pubDate>
</item>"""


def _feed(items: list[dict]) -> bytes:
    body = "\n".join(_ITEM_TEMPLATE.format(**i) for i in items)
    return _RSS_TEMPLATE.format(items=body).encode()


def _recent_pubdate(days_ago: int = 1) -> str:
    """An RFC-2822 date `days_ago` days old, computed at run time.

    These tests used to hardcode "Mon, 27 Jul 2026 10:00:00 GMT". That sat
    inside NEWS_MAX_ITEM_AGE_DAYS (14) when they were written and outside it a
    fortnight later, at which point `fetch_all_sources` dropped every fixture
    item and four tests started failing for a reason unrelated to what they
    were testing. A fixture that expires is a test that lies about the code.
    """
    return format_datetime(datetime.now(timezone.utc) - timedelta(days=days_ago))


def _mock_transport(handler):
    return httpx.MockTransport(handler)


@pytest.fixture(autouse=True)
def _small_source_list(monkeypatch):
    """Every test below controls exactly which sources exist, independent of
    the real curated list in sources.py — keeps these tests stable even if
    that list changes.
    """
    monkeypatch.setattr(fetcher, "SOURCES", [], raising=False)


def test_one_slow_source_does_not_block_others(monkeypatch):
    good_feed = _feed([{
        "title": "Fast item", "link": "https://a.example/1",
        "description": "desc", "pubdate": _recent_pubdate(),
    }])

    async def handler(request: httpx.Request) -> httpx.Response:
        if "slow" in str(request.url):
            raise httpx.ReadTimeout("simulated timeout", request=request)
        return httpx.Response(200, content=good_feed)

    monkeypatch.setattr(fetcher, "SOURCES", [
        ("https://slow.example/rss", "Slow Source", "research"),
        ("https://a.example/rss", "Fast Source", "research"),
    ], raising=False)
    monkeypatch.setattr(fetcher, "_build_client", lambda: httpx.AsyncClient(transport=_mock_transport(handler)))

    items = asyncio.run(fetcher.fetch_all_sources())
    assert len(items) == 1
    assert items[0].source == "Fast Source"


def test_oversized_response_is_truncated_not_hung(monkeypatch):
    huge_item = _feed([{
        "title": "T", "link": "https://a.example/1",
        "description": "x" * (fetcher._MAX_BYTES + 1000), "pubdate": "",
    }])

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=huge_item)

    monkeypatch.setattr(fetcher, "SOURCES", [("https://a.example/rss", "Big Source", "research")], raising=False)
    monkeypatch.setattr(fetcher, "_build_client", lambda: httpx.AsyncClient(transport=_mock_transport(handler)))

    # Must not raise, must not hang — either 0 or 1 malformed-but-parsed items.
    items = asyncio.run(fetcher.fetch_all_sources())
    assert isinstance(items, list)


def test_non_2xx_response_is_skipped(monkeypatch):
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, content=b"error")

    monkeypatch.setattr(fetcher, "SOURCES", [("https://a.example/rss", "Broken Source", "research")], raising=False)
    monkeypatch.setattr(fetcher, "_build_client", lambda: httpx.AsyncClient(transport=_mock_transport(handler)))

    items = asyncio.run(fetcher.fetch_all_sources())
    assert items == []


def test_items_older_than_max_age_are_dropped(monkeypatch):
    old_feed = _feed([{
        "title": "Old", "link": "https://a.example/old",
        "description": "d", "pubdate": "Mon, 01 Jan 2001 00:00:00 GMT",
    }, {
        "title": "New", "link": "https://a.example/new",
        "description": "d", "pubdate": _recent_pubdate(),
    }])

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=old_feed)

    monkeypatch.setattr(fetcher, "SOURCES", [("https://a.example/rss", "Mixed Source", "research")], raising=False)
    monkeypatch.setattr(fetcher, "_build_client", lambda: httpx.AsyncClient(transport=_mock_transport(handler)))

    items = asyncio.run(fetcher.fetch_all_sources())
    assert [i.title for i in items] == ["New"]


def test_per_feed_item_cap_is_enforced(monkeypatch):
    monkeypatch.setattr(settings, "NEWS_MAX_ITEMS_PER_FEED", 2)
    many_feed = _feed([
        {"title": f"Item {n}", "link": f"https://a.example/{n}", "description": "d", "pubdate": _recent_pubdate()}
        for n in range(5)
    ])

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=many_feed)

    monkeypatch.setattr(fetcher, "SOURCES", [("https://a.example/rss", "Prolific Source", "research")], raising=False)
    monkeypatch.setattr(fetcher, "_build_client", lambda: httpx.AsyncClient(transport=_mock_transport(handler)))

    items = asyncio.run(fetcher.fetch_all_sources())
    assert len(items) == 2


def test_entries_missing_a_link_are_skipped(monkeypatch):
    linkless = b"""<?xml version="1.0"?>
<rss version="2.0"><channel>
<item><title>No link</title><description>d</description></item>
</channel></rss>"""

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=linkless)

    monkeypatch.setattr(fetcher, "SOURCES", [("https://a.example/rss", "Linkless Source", "research")], raising=False)
    monkeypatch.setattr(fetcher, "_build_client", lambda: httpx.AsyncClient(transport=_mock_transport(handler)))

    items = asyncio.run(fetcher.fetch_all_sources())
    assert items == []


def test_fetched_items_carry_source_and_topic_and_unsummarized_vi_fields(monkeypatch):
    feed = _feed([{
        "title": "Some Title", "link": "https://a.example/1",
        "description": "Some description", "pubdate": _recent_pubdate(),
    }])

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=feed)

    monkeypatch.setattr(fetcher, "SOURCES", [("https://a.example/rss", "My Source", "robotics")], raising=False)
    monkeypatch.setattr(fetcher, "_build_client", lambda: httpx.AsyncClient(transport=_mock_transport(handler)))

    items = asyncio.run(fetcher.fetch_all_sources())
    assert len(items) == 1
    item = items[0]
    assert item.source == "My Source"
    assert item.topic == "robotics"
    assert item.title == "Some Title"
    assert item.description_raw == "Some description"
    assert item.title_vi == ""
    assert item.summary_vi == ""
    assert item.url == "https://a.example/1"
