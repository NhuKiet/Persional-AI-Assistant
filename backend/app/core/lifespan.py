import asyncio
import logging
import threading
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

    # BGE reranker (~2GB) tải từ HuggingFace Hub khi dùng lần đầu — tải ở đây,
    # nền, ngay khi server khởi động, thay vì để request research đầu tiên
    # của user gánh việc tải model đó (từng khiến research "bị treo" hàng
    # phút sau mỗi lần restart container/cache trống).
    def _warm_reranker():
        from backend.app.features.research.reranker import _bge_reranker
        _bge_reranker()

    threading.Thread(target=_warm_reranker, daemon=True).start()

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
