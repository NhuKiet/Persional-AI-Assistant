import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

from backend.app.shared.files import ensure_runtime_directories


logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_runtime_directories(Path(__file__).resolve().parents[3])

    try:
        from backend.app.shared.conversation_store import _store

        deleted = _store.cleanup_old(max_age_days=30)
        if deleted:
            logger.info("Cleaned up %d old chat sessions", deleted)
    except Exception as e:
        logger.warning("Session cleanup failed (non-fatal): %s", e)

    logger.info("KiNg backend v3 started — research + chat + coding + PDF ready")
    yield
