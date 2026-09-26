import asyncio
import json
import logging
import threading
import time

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse

from backend.app.core.rate_limit import rate_limit
from backend.app.features.research.prompts import DEEP_DIVE_SYSTEM
from backend.app.features.research.schemas import DeepDiveRequest, ResearchRequest, SessionHistoryResponse
from backend.app.features.research.search.community import fetch_trending_papers
from backend.app.features.research.service import ResearchService, SessionBusyError
from backend.app.shared.model_guard import require_allowed_model
from backend.app.shared.session_locks import log_concurrent_rejection

logger = logging.getLogger(__name__)

router = APIRouter(tags=["research"])

_service: ResearchService | None = None

# Trending-papers cache: HuggingFace's daily_papers list changes at most once
# a day, and the endpoint is flaky over some networks — cache successful
# responses for an hour and keep serving stale data on failure rather than
# ever surfacing an empty suggestion list to the frontend. A failed fetch is
# retried only after a short back-off, not on every page load.
_TRENDING_TTL_SECONDS = 3600
_TRENDING_RETRY_SECONDS = 300
_trending_cache: dict = {"next_fetch": 0.0, "titles": []}
_trending_lock = threading.Lock()


def get_service() -> ResearchService:
    global _service
    if _service is None:
        _service = ResearchService()
    return _service


def sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/api/research/stream", dependencies=[Depends(rate_limit("research"))])
async def research_stream(req: ResearchRequest):
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Query required")
    require_allowed_model(req.provider, req.model)

    service = get_service()
    try:
        lock = service.begin_session(req.session_id)
    except SessionBusyError:
        log_concurrent_rejection(logger, "research", req.session_id)
        return JSONResponse(status_code=409, content={"detail": "session_busy"})

    async def generate():
        try:
            async for event in service.stream_events(req):
                yield sse(event)
        finally:
            service.end_session(lock)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/api/research/deep-dive", dependencies=[Depends(rate_limit("expensive"))])
async def deep_dive(req: DeepDiveRequest):
    """Answer a follow-up question grounded in a single source (SSE streaming)."""
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question required")
    require_allowed_model(req.provider, req.model)

    service = get_service()
    try:
        lock = service.begin_session(req.session_id)
    except SessionBusyError:
        log_concurrent_rejection(logger, "research", req.session_id)
        return JSONResponse(status_code=409, content={"detail": "session_busy"})

    async def generate():
        try:
            async for event in service.deep_dive_events(req, DEEP_DIVE_SYSTEM):
                yield sse(event)
        finally:
            service.end_session(lock)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# Plain `def`, not `async def`: the history store is synchronous psycopg, so
# FastAPI must run this on its threadpool (tests/test_event_loop_blocking.py).
@router.get("/api/research/sessions/{session_id}", response_model=SessionHistoryResponse)
def get_research_session_history(session_id: str):
    """Read-only session history restore. Never touches the session lock."""
    messages, revision = get_service().get_history_with_revision(session_id)
    if not messages:
        raise HTTPException(status_code=404, detail="session_not_found")
    return SessionHistoryResponse(
        session_id=session_id, feature="research", revision=revision, messages=messages
    )


@router.get("/api/research/trending")
async def get_trending_papers():
    """Tiêu đề paper nổi bật hôm nay — frontend trộn vào gợi ý research để
    vừa gợi ý chủ đề vừa cho biết có nghiên cứu gì mới. Cache 1h; nếu
    HuggingFace lỗi/timeout thì trả cache cũ (rỗng nếu chưa từng fetch được)
    thay vì lỗi cả request — đây chỉ là gợi ý, không phải dữ liệu bắt buộc."""
    now = time.time()
    with _trending_lock:
        due = now >= _trending_cache["next_fetch"]
        if due:
            # Claim this refresh: concurrent page loads keep serving the cache
            # instead of each starting its own fetch.
            _trending_cache["next_fetch"] = now + _TRENDING_RETRY_SECONDS
    if due:
        # Synchronous httpx with an 8 s timeout — keep it off the event loop.
        titles = await asyncio.to_thread(fetch_trending_papers, k=6)
        if titles:
            with _trending_lock:
                _trending_cache["titles"] = titles
                _trending_cache["next_fetch"] = now + _TRENDING_TTL_SECONDS
    with _trending_lock:
        return {"suggestions": list(_trending_cache["titles"])}
