import asyncio

import pytest

from backend.app.core.config import settings
from backend.app.features.news import scheduler
from backend.app.features.news.models import NewsItem, RefreshResult


@pytest.fixture(autouse=True)
def _reset_scheduler_state():
    scheduler._inflight = None
    scheduler._last_completed_at = 0.0
    yield
    scheduler._inflight = None
    scheduler._last_completed_at = 0.0


def test_two_concurrent_refreshes_run_the_pipeline_exactly_once(monkeypatch):
    call_count = 0

    async def fake_pipeline():
        nonlocal call_count
        call_count += 1
        await asyncio.sleep(0.05)
        return RefreshResult(new_count=3)

    monkeypatch.setattr(scheduler, "_run_refresh_pipeline", fake_pipeline)

    async def two_concurrent_calls():
        return await asyncio.gather(scheduler.refresh_news(), scheduler.refresh_news())

    r1, r2 = asyncio.run(two_concurrent_calls())
    assert call_count == 1
    assert r1.new_count == r2.new_count == 3


def test_sequential_refreshes_after_completion_each_run_the_pipeline(monkeypatch):
    call_count = 0

    async def fake_pipeline():
        nonlocal call_count
        call_count += 1
        return RefreshResult(new_count=1)

    monkeypatch.setattr(scheduler, "_run_refresh_pipeline", fake_pipeline)

    asyncio.run(scheduler.refresh_news())
    asyncio.run(scheduler.refresh_news())
    assert call_count == 2


def test_seconds_since_last_refresh_is_infinite_before_any_run():
    assert scheduler.seconds_since_last_refresh() == float("inf")


def test_seconds_since_last_refresh_updates_after_a_run(monkeypatch):
    async def fake_pipeline():
        return RefreshResult(new_count=0)

    monkeypatch.setattr(scheduler, "_run_refresh_pipeline", fake_pipeline)
    asyncio.run(scheduler.refresh_news())
    assert scheduler.seconds_since_last_refresh() < 1.0


def test_start_background_task_returns_none_when_storage_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_DB_URL", None)
    assert scheduler.start_background_task() is None


def test_start_background_task_returns_a_task_when_storage_configured(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_DB_URL", "postgresql://fake/db")

    async def run():
        task = scheduler.start_background_task()
        assert isinstance(task, asyncio.Task)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    asyncio.run(run())


def test_run_refresh_pipeline_wires_fetch_summarize_store(monkeypatch):
    fetched = [NewsItem(
        url="https://example.com/a", title="T", description_raw="D",
        source="S", topic="research", published_at=None, fetched_at=None,
    )]

    async def fake_fetch():
        return fetched

    async def fake_summarize(items, provider=None, model=None):
        for i in items:
            i.title_vi, i.summary_vi = "TV", "SV"
        return items

    class _FakeStore:
        def existing_urls(self, candidate_urls):
            return set()

        def add_new(self, items):
            assert items[0].title_vi == "TV"
            return len(items)

    monkeypatch.setattr(scheduler, "fetch_all_sources", fake_fetch)
    monkeypatch.setattr(scheduler, "summarize_new_items", fake_summarize)
    monkeypatch.setattr(scheduler, "_store", _FakeStore())

    result = asyncio.run(scheduler._run_refresh_pipeline())
    assert result.new_count == 1


def test_run_refresh_pipeline_skips_already_stored_urls(monkeypatch):
    fetched = [
        NewsItem(url="https://example.com/old", title="Old", description_raw="D", source="S", topic="research", published_at=None, fetched_at=None),
        NewsItem(url="https://example.com/new", title="New", description_raw="D", source="S", topic="research", published_at=None, fetched_at=None),
    ]

    async def fake_fetch():
        return fetched

    summarized_urls = []

    async def fake_summarize(items, provider=None, model=None):
        summarized_urls.extend(i.url for i in items)
        for i in items:
            i.title_vi, i.summary_vi = "TV", "SV"
        return items

    class _FakeStore:
        def existing_urls(self, candidate_urls):
            return {"https://example.com/old"}

        def add_new(self, items):
            return len(items)

    monkeypatch.setattr(scheduler, "fetch_all_sources", fake_fetch)
    monkeypatch.setattr(scheduler, "summarize_new_items", fake_summarize)
    monkeypatch.setattr(scheduler, "_store", _FakeStore())

    asyncio.run(scheduler._run_refresh_pipeline())
    assert summarized_urls == ["https://example.com/new"]


def test_run_refresh_pipeline_caps_new_items_per_run(monkeypatch):
    fetched = [
        NewsItem(url=f"https://example.com/{n}", title=f"T{n}", description_raw="D", source="S", topic="research", published_at=None, fetched_at=None)
        for n in range(5)
    ]

    async def fake_fetch():
        return fetched

    async def fake_summarize(items, provider=None, model=None):
        for i in items:
            i.title_vi, i.summary_vi = "TV", "SV"
        return items

    class _FakeStore:
        def existing_urls(self, candidate_urls):
            return set()

        def add_new(self, items):
            return len(items)

    monkeypatch.setattr(settings, "NEWS_MAX_NEW_ITEMS_PER_RUN", 2)
    monkeypatch.setattr(scheduler, "fetch_all_sources", fake_fetch)
    monkeypatch.setattr(scheduler, "summarize_new_items", fake_summarize)
    monkeypatch.setattr(scheduler, "_store", _FakeStore())

    result = asyncio.run(scheduler._run_refresh_pipeline())
    assert result.new_count == 2
