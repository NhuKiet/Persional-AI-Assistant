from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.core.config import settings
from backend.app.features.news import router as news_router_mod
from backend.app.features.news.models import NewsItem, RefreshResult

app = FastAPI()
app.include_router(news_router_mod.router)
client = TestClient(app)


def _item(n: int) -> NewsItem:
    return NewsItem(
        url=f"https://example.com/{n}", title=f"T{n}", description_raw="D",
        source="S", topic="research",
        published_at=datetime(2026, 7, 27, tzinfo=timezone.utc),
        fetched_at=datetime(2026, 7, 28, tzinfo=timezone.utc),
        title_vi=f"TV{n}", summary_vi=f"SV{n}",
    )


class _FakeStore:
    def __init__(self, items):
        self._items = items

    def list_items(self, topic, limit, offset):
        filtered = [i for i in self._items if topic is None or i.topic == topic]
        page = filtered[offset:offset + limit]
        return page, len(filtered) > offset + limit


def test_get_news_returns_envelope_shape(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_DB_URL", "postgresql://fake/db")
    monkeypatch.setattr(news_router_mod, "_store", _FakeStore([_item(0), _item(1)]))

    resp = client.get("/api/news")
    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) == {"items", "limit", "offset", "has_more"}
    assert len(body["items"]) == 2
    assert body["items"][0]["title_vi"] == "TV0"


def test_get_news_filters_by_topic(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_DB_URL", "postgresql://fake/db")
    robotics_item = _item(0)
    robotics_item.topic = "robotics"
    monkeypatch.setattr(news_router_mod, "_store", _FakeStore([robotics_item, _item(1)]))

    resp = client.get("/api/news", params={"topic": "robotics"})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) == 1
    assert body["items"][0]["topic"] == "robotics"


def test_get_news_rejects_invalid_topic(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_DB_URL", "postgresql://fake/db")
    monkeypatch.setattr(news_router_mod, "_store", _FakeStore([]))
    resp = client.get("/api/news", params={"topic": "not_a_real_topic"})
    assert resp.status_code == 422


def test_get_news_rejects_out_of_range_limit(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_DB_URL", "postgresql://fake/db")
    monkeypatch.setattr(news_router_mod, "_store", _FakeStore([]))
    assert client.get("/api/news", params={"limit": 0}).status_code == 422
    assert client.get("/api/news", params={"limit": 101}).status_code == 422


def test_get_news_rejects_negative_offset(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_DB_URL", "postgresql://fake/db")
    monkeypatch.setattr(news_router_mod, "_store", _FakeStore([]))
    assert client.get("/api/news", params={"offset": -1}).status_code == 422


def test_get_news_returns_503_when_storage_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_DB_URL", None)
    resp = client.get("/api/news")
    assert resp.status_code == 503


def test_post_refresh_returns_503_when_storage_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_DB_URL", None)
    resp = client.post("/api/news/refresh")
    assert resp.status_code == 503


def test_post_refresh_calls_scheduler_and_returns_new_count(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_DB_URL", "postgresql://fake/db")
    monkeypatch.setattr(news_router_mod.scheduler, "seconds_since_last_refresh", lambda: float("inf"))

    async def fake_refresh():
        return RefreshResult(new_count=7)

    monkeypatch.setattr(news_router_mod.scheduler, "refresh_news", fake_refresh)

    resp = client.post("/api/news/refresh")
    assert resp.status_code == 200
    assert resp.json() == {"new_count": 7}


def test_post_refresh_returns_429_within_cooldown(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_DB_URL", "postgresql://fake/db")
    monkeypatch.setattr(settings, "NEWS_MANUAL_COOLDOWN_SECONDS", 60)
    monkeypatch.setattr(news_router_mod.scheduler, "seconds_since_last_refresh", lambda: 5.0)

    async def fail_if_called():
        raise AssertionError("refresh_news should not run within cooldown")

    monkeypatch.setattr(news_router_mod.scheduler, "refresh_news", fail_if_called)

    resp = client.post("/api/news/refresh")
    assert resp.status_code == 429
