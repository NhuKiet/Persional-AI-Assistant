"""Refresh orchestration. Single-flight: a scheduled tick and a manual
refresh that overlap in time await the SAME pipeline run and get the SAME
RefreshResult, rather than each running (and paying for) their own full
pipeline. This is an in-process asyncio.Task — it coordinates within one
Uvicorn worker only (see the design spec §3's multi-worker caveat).
"""
import asyncio
import logging
import time

from backend.app.core.config import settings
from backend.app.features.news.fetcher import fetch_all_sources
from backend.app.features.news.models import RefreshResult
from backend.app.features.news.store import _store
from backend.app.features.news.summarizer import summarize_new_items

logger = logging.getLogger(__name__)

_inflight: asyncio.Task | None = None
_last_completed_at: float = 0.0


async def _run_refresh_pipeline() -> RefreshResult:
    fetched = await fetch_all_sources()
    candidate_urls = [item.url for item in fetched]
    existing = await asyncio.to_thread(_store.existing_urls, candidate_urls)
    new_items = [item for item in fetched if item.url not in existing]
    new_items = new_items[: settings.NEWS_MAX_NEW_ITEMS_PER_RUN]

    summarized = await summarize_new_items(new_items)
    stored = await asyncio.to_thread(_store.add_new, summarized)
    return RefreshResult(new_count=stored)


async def refresh_news() -> RefreshResult:
    global _inflight, _last_completed_at
    if _inflight is not None and not _inflight.done():
        return await _inflight
    _inflight = asyncio.ensure_future(_run_refresh_pipeline())
    try:
        result = await _inflight
        _last_completed_at = time.time()
        return result
    finally:
        _inflight = None


def seconds_since_last_refresh() -> float:
    if not _last_completed_at:
        return float("inf")
    return time.time() - _last_completed_at


async def _background_loop() -> None:
    while True:
        try:
            await refresh_news()
        except Exception:
            logger.warning("[NEWS] background refresh failed (non-fatal)", exc_info=True)
        await asyncio.sleep(settings.NEWS_REFRESH_INTERVAL_SECONDS)


def start_background_task() -> asyncio.Task | None:
    if not settings.SUPABASE_DB_URL:
        logger.info("[NEWS] SUPABASE_DB_URL not configured — background refresh disabled")
        return None
    return asyncio.create_task(_background_loop())
