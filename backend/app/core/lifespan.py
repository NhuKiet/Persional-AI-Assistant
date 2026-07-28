import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

from backend.app.shared.files import ensure_runtime_directories


logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    from backend.app.shared.conversation_store import _store
    from backend.app.features.news.scheduler import start_background_task
    from backend.app.features.news.store import _store as _news_store

    ensure_runtime_directories(Path(__file__).resolve().parents[3])

    try:
        deleted = _store.cleanup_old(max_age_days=30)
        if deleted:
            logger.info("Cleaned up %d old chat sessions", deleted)
    except Exception as e:
        logger.warning("Session cleanup failed (non-fatal): %s", e)

    try:
        pruned = _news_store.prune_older_than(days=30)
        if pruned:
            logger.info("Pruned %d old news items", pruned)
    except Exception as e:
        logger.warning("News prune failed (non-fatal): %s", e)

    news_task = start_background_task()

    logger.info("KiNg backend v3 started — research + chat + coding + PDF + news ready")
    yield

    if news_task is not None:
        news_task.cancel()
        try:
            await news_task
        except asyncio.CancelledError:
            pass

    _news_store.close()
    _store.close()
    logger.info("KiNg backend shutting down — Supabase connection pools closed")
