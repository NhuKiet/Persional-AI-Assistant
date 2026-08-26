import asyncio
import logging
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

from backend.app.core import capabilities
from backend.app.shared.files import ensure_runtime_directories


logger = logging.getLogger(__name__)


def _seed_capabilities() -> None:
    """One probe per capability so the registry is not all-unknown before
    the first request.

    The LLM is deliberately not probed: it is the only one of the four
    whose probe costs a real billed completion on every start, which under
    --reload is every file save. What that buys is small — the first
    research request arrives seconds later and reports the provider's true
    state under real load. The common configuration failure, a missing API
    key, already raises loudly from get_llm and is not in the silent class
    this registry exists to catch.
    """
    from backend.app.features.research.reranker import reranker_selfcheck
    from backend.app.features.research.embeddings import embed_query
    from backend.app.features.research.knowledge_store import get_store

    problem = reranker_selfcheck()
    if problem:
        capabilities.failed(capabilities.RERANKER, problem)
        logger.error(
            "Cross-encoder reranking is NOT working (%s) — research will "
            "rank by credibility only. Check RERANKER_MODEL, the "
            "sentence-transformers/transformers versions, or set "
            "COHERE_API_KEY to use the hosted reranker instead.",
            problem,
        )
    else:
        capabilities.ok(capabilities.RERANKER)

    # Both of these report from their own boundaries; the try/except here
    # exists only so a probe failure cannot kill the startup thread.
    try:
        embed_query("healthcheck")
    except Exception as e:
        logger.warning("Embeddings probe failed at boot: %s", e)

    try:
        get_store().size()
    except Exception as e:
        logger.warning("Knowledge store probe failed at boot: %s", e)

    snap = capabilities.snapshot()
    if snap["status"] != capabilities.OK:
        degraded = [n for n, c in snap["capabilities"].items()
                    if c["status"] == capabilities.DEGRADED]
        logger.error("Capabilities degraded at boot: %s", ", ".join(degraded))


# Module level, not a closure inside lifespan(): a test that needs the app
# to start without probing has to be able to patch this by name. The only
# alternative is patching threading.Thread, which replaces it process-wide
# and hangs anything using a ThreadPoolExecutor.

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

    threading.Thread(target=_seed_capabilities, daemon=True).start()

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
