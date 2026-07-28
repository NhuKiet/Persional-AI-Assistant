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
from backend.app.features.news.models import NewsItem, RefreshResult
from backend.app.features.news.store import _store
from backend.app.features.news.summarizer import summarize_new_items

logger = logging.getLogger(__name__)

_inflight: asyncio.Task | None = None
_last_completed_at: float = 0.0


async def _run_refresh_pipeline() -> RefreshResult:
    fetched = await fetch_all_sources()
    # Multiple feeds can surface the same article under the same
    # normalized URL (arXiv cs.AI/cs.RO cross-listing is the common case)
    # — collapse those BEFORE the DB check and the cap, or the same item
    # gets summarized twice (wasted LLM cost) and silently miscounts
    # new_count when the second insert hits ON CONFLICT DO NOTHING.
    deduped: dict[str, NewsItem] = {}
    for item in fetched:
        deduped.setdefault(item.url, item)

    candidate_urls = list(deduped.keys())
    existing = await asyncio.to_thread(_store.existing_urls, candidate_urls)
    new_items = [item for url, item in deduped.items() if url not in existing]
    new_items = new_items[: settings.NEWS_MAX_NEW_ITEMS_PER_RUN]

    summarized = await summarize_new_items(new_items)
    stored = await asyncio.to_thread(_store.add_new, summarized)
    return RefreshResult(new_count=stored)


async def refresh_news() -> RefreshResult:
    global _inflight
    if _inflight is not None and not _inflight.done():
        return await asyncio.shield(_inflight)
    task = asyncio.ensure_future(_run_refresh_pipeline())
    task.add_done_callback(_on_pipeline_done)
    _inflight = task
    # asyncio.shield() matters here, not just cosmetically: awaiting a Task
    # directly makes it the awaiter's `_fut_waiter`, so if THIS caller's own
    # coroutine gets cancelled (e.g. Starlette cancelling a disconnected
    # request), plain `Task.cancel()` propagates into whatever future it is
    # currently suspended on — cancelling the pipeline task too. Shielding
    # decouples them: only the shield's wrapper future is cancelled, and the
    # pipeline task itself (and `_inflight`) keeps running untouched, so a
    # concurrent/subsequent caller still joins the same in-progress run.
    return await asyncio.shield(task)


def _on_pipeline_done(task: asyncio.Task) -> None:
    """Runs once when the pipeline task itself finishes — regardless of
    whether the caller that originally started it is still awaiting it.
    This is what makes single-flight cancellation-safe: an awaiting caller
    getting cancelled (e.g. a disconnected HTTP request) does NOT clear
    `_inflight` or reset the cooldown timer early, because this callback
    only fires when the task ITSELF completes, not when one of its
    awaiters stops awaiting it.
    """
    global _inflight, _last_completed_at
    if task is _inflight:
        _inflight = None
    if task.cancelled():
        return
    # Arm the cooldown on both success and failure — a failed run still
    # spent the LLM/network budget the cooldown exists to protect, so a
    # caller retrying immediately after a failure shouldn't get to spend
    # it again right away.
    _last_completed_at = time.time()
    # Retrieve the exception (if any) so asyncio doesn't log "exception was
    # never retrieved" for a task whose original awaiter got cancelled
    # before consuming it — any caller whose own `await task` actually
    # completes still sees the exception raised normally; this call is
    # purely to mark it as observed for bookkeeping.
    task.exception()


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
