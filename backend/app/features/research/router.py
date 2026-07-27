import json
import logging
import os
import threading
import time

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

from backend.app.features.research.prompts import DEEP_DIVE_SYSTEM
from backend.app.features.research.schemas import DeepDiveRequest, ResearchRequest, SessionHistoryResponse
from backend.app.features.research.search.community import fetch_trending_papers
from backend.app.features.research.service import ResearchService, SessionBusyError
from backend.app.shared.session_locks import log_concurrent_rejection

logger = logging.getLogger(__name__)

router = APIRouter(tags=["research"])

_service: ResearchService | None = None

# Trending-papers cache: HuggingFace's daily_papers list changes at most once
# a day, and the endpoint is flaky over some networks — cache successful
# responses for an hour and keep serving stale data on failure rather than
# ever surfacing an empty suggestion list to the frontend.
_TRENDING_TTL_SECONDS = 3600
_trending_cache: dict = {"ts": 0.0, "titles": []}
_trending_lock = threading.Lock()


def get_service() -> ResearchService:
    global _service
    if _service is None:
        _service = ResearchService()
    return _service


def sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/api/research/stream")
async def research_stream(req: ResearchRequest):
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Query required")

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


@router.post("/api/research/deep-dive")
async def deep_dive(req: DeepDiveRequest):
    """Answer a follow-up question grounded in a single source (SSE streaming)."""
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question required")

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


@router.get("/api/research/sessions/{session_id}", response_model=SessionHistoryResponse)
async def get_research_session_history(session_id: str):
    """Read-only session history restore. Never touches the session lock."""
    messages, revision = get_service().get_history_with_revision(session_id)
    if not messages:
        raise HTTPException(status_code=404, detail="session_not_found")
    return SessionHistoryResponse(
        session_id=session_id, feature="research", revision=revision, messages=messages
    )


@router.get("/api/paper/{filename}")
async def serve_paper(filename: str):
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = f"data/papers/{filename}"
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Paper not found")
    return FileResponse(path, media_type="application/pdf")


@router.get("/api/research/trending")
async def get_trending_papers():
    """Tiêu đề paper nổi bật hôm nay — frontend trộn vào gợi ý research để
    vừa gợi ý chủ đề vừa cho biết có nghiên cứu gì mới. Cache 1h; nếu
    HuggingFace lỗi/timeout thì trả cache cũ (rỗng nếu chưa từng fetch được)
    thay vì lỗi cả request — đây chỉ là gợi ý, không phải dữ liệu bắt buộc."""
    now = time.time()
    with _trending_lock:
        stale = now - _trending_cache["ts"] > _TRENDING_TTL_SECONDS
    if stale:
        titles = fetch_trending_papers(k=6)
        if titles:
            with _trending_lock:
                _trending_cache["titles"] = titles
                _trending_cache["ts"] = now
    with _trending_lock:
        return {"suggestions": list(_trending_cache["titles"])}


@router.delete("/api/research/cache")
async def clear_research_cache():
    """Clear the research query cache (forces re-search on next request)."""
    get_service().clear_cache()
    return {"cleared": True, "message": "Research cache cleared"}
