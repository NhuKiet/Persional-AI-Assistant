import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from backend.app.core.config import settings
from backend.app.features.news.models import NewsItem
from backend.app.features.news.store import _SupabaseNewsStore


def test_constructor_does_not_raise_or_connect_without_config(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_DB_URL", None)
    store = _SupabaseNewsStore()  # must not raise
    assert store._pool is None    # must not have connected either


def test_method_call_raises_clearly_when_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_DB_URL", None)
    store = _SupabaseNewsStore()
    with pytest.raises(RuntimeError, match="SUPABASE_DB_URL"):
        store.existing_urls(["https://example.com/a"])


def test_close_before_any_use_does_not_raise(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_DB_URL", None)
    store = _SupabaseNewsStore()
    store.close()  # never opened a pool — must be a safe no-op


def test_existing_urls_empty_input_returns_empty_without_opening_pool(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_DB_URL", None)
    store = _SupabaseNewsStore()
    assert store.existing_urls([]) == set()  # short-circuits before _get_pool()


def test_add_new_empty_input_returns_zero_without_opening_pool(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_DB_URL", None)
    store = _SupabaseNewsStore()
    assert store.add_new([]) == 0


def _item(url: str, topic: str = "research", published_at=None) -> NewsItem:
    return NewsItem(
        url=url, title="T", description_raw="D", source="S", topic=topic,
        published_at=published_at, fetched_at=datetime.now(timezone.utc),
    )


@pytest.fixture
def news_store(monkeypatch):
    db_url = os.environ["SUPABASE_TEST_DATABASE_URL"]
    monkeypatch.setattr(settings, "SUPABASE_DB_URL", db_url)
    store = _SupabaseNewsStore()
    yield store
    store.close()


@pytest.mark.supabase_integration
def test_add_new_is_idempotent_on_conflicting_url(news_store):
    url = f"https://example.com/{uuid.uuid4().hex}"
    item = _item(url)
    assert news_store.add_new([item]) == 1
    assert news_store.add_new([item]) == 0  # already exists — ON CONFLICT DO NOTHING
    assert news_store.existing_urls([url]) == {url}


@pytest.mark.supabase_integration
def test_list_items_filters_by_topic(news_store):
    a = f"https://example.com/{uuid.uuid4().hex}"
    b = f"https://example.com/{uuid.uuid4().hex}"
    news_store.add_new([_item(a, topic="robotics"), _item(b, topic="research")])
    items, _ = news_store.list_items(topic="robotics", limit=50, offset=0)
    urls = {i.url for i in items}
    assert a in urls
    assert b not in urls


@pytest.mark.supabase_integration
def test_list_items_orders_null_published_at_last(news_store):
    with_date = f"https://example.com/{uuid.uuid4().hex}"
    without_date = f"https://example.com/{uuid.uuid4().hex}"
    news_store.add_new([
        _item(without_date, published_at=None),
        _item(with_date, published_at=datetime.now(timezone.utc)),
    ])
    items, _ = news_store.list_items(topic=None, limit=50, offset=0)
    urls_in_order = [i.url for i in items]
    assert urls_in_order.index(with_date) < urls_in_order.index(without_date)


@pytest.mark.supabase_integration
def test_list_items_has_more_flag(news_store):
    for _ in range(3):
        news_store.add_new([_item(f"https://example.com/{uuid.uuid4().hex}")])
    items, has_more = news_store.list_items(topic=None, limit=2, offset=0)
    assert len(items) == 2
    assert has_more is True


@pytest.mark.supabase_integration
def test_prune_older_than_deletes_old_rows_only(news_store):
    old_url = f"https://example.com/{uuid.uuid4().hex}"
    news_store.add_new([_item(old_url)])
    with news_store._get_pool().connection() as conn:
        conn.execute(
            "update news_items set fetched_at = now() - interval '40 days' where url = %s",
            (old_url,),
        )
    recent_url = f"https://example.com/{uuid.uuid4().hex}"
    news_store.add_new([_item(recent_url)])

    deleted = news_store.prune_older_than(days=30)
    assert deleted >= 1
    assert news_store.existing_urls([old_url]) == set()
    assert news_store.existing_urls([recent_url]) == {recent_url}
