import asyncio
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse

from backend.app.core.config import settings
from backend.app.core.rate_limit import rate_limit
from backend.app.features.coding.artifacts import ArtifactService, artifact_response
from backend.app.features.coding.execution import executor_status
from backend.app.features.coding.schemas import CodingRequest, SessionHistoryResponse
from backend.app.features.coding.service import CodingService, SessionBusyError
from backend.app.features.coding.uploads import UploadService
from backend.app.shared.conversation_store import ConversationManager
from backend.app.shared.session_locks import log_concurrent_rejection
from backend.app.shared.model_guard import require_allowed_model
from backend.app.shared.sse import sse


logger = logging.getLogger(__name__)

router = APIRouter(tags=["coding"])

_conv_manager = ConversationManager(namespace="coding")
_service = CodingService(conversations=_conv_manager)
_uploads = UploadService()
_artifacts = ArtifactService()


@router.get("/api/coding/status")
async def coding_status(refresh: bool = False):
    """Can generated code run right now? Read when the Coding page opens, so
    a missing sandbox is said up front instead of after a whole plan. The
    limits are the ones every run gets (see _docker_run_argv)."""
    status = await asyncio.to_thread(executor_status, refresh=refresh)
    return {
        "executor": {
            "available": status.available,
            "reason": status.reason,
            "image": settings.EXECUTOR_IMAGE,
            "timeout_s": settings.CODE_TIMEOUT,
            "memory": settings.EXECUTOR_MEMORY,
            "network": False,
        },
    }


@router.post("/api/coding/upload")
async def upload_file(file: UploadFile = File(...), session_id: str = Form("default")):
    content = await file.read()
    return await asyncio.to_thread(_uploads.save, session_id, file.filename or "", content)


@router.delete("/api/coding/file/{filename}")
async def delete_file(filename: str, session_id: str = "default"):
    _uploads.delete(session_id, filename)
    return {"deleted": filename}


@router.post("/api/coding/stream", dependencies=[Depends(rate_limit("expensive"))])
async def coding_stream(req: CodingRequest):
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Message required")
    if len(req.message) > settings.MAX_MESSAGE_CHARS:
        raise HTTPException(status_code=413, detail=f"Message quá dài (giới hạn {settings.MAX_MESSAGE_CHARS} ký tự).")
    require_allowed_model(req.provider, req.model)

    req.message = req.message.strip()

    try:
        lock = _service.begin_session(req.session_id)
    except SessionBusyError:
        log_concurrent_rejection(logger, "coding", req.session_id)
        return JSONResponse(status_code=409, content={"detail": "session_busy"})

    async def generate():
        try:
            async for event in _service.stream(req):
                yield sse(event)
        finally:
            _service.end_session(lock)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/api/coding/artifact/{session_id}/{filename}")
async def serve_session_artifact(session_id: str, filename: str):
    path = _artifacts.resolve(session_id, filename)
    return artifact_response(path)


@router.get("/api/coding/artifact/{filename}")
async def serve_artifact(filename: str):
    path = _artifacts.resolve_root(filename)
    return artifact_response(path)


# Plain `def`, not `async def`: the history store is synchronous psycopg, so
# FastAPI must run this on its threadpool (tests/test_event_loop_blocking.py).
@router.delete("/api/coding/session/{session_id}")
def clear_coding_session(session_id: str):
    _conv_manager.clear_session(session_id)
    return {"cleared": session_id}


@router.get("/api/coding/sessions/{session_id}", response_model=SessionHistoryResponse)
def get_coding_session_history(session_id: str):
    """Read-only session history restore. Never touches the session lock."""
    messages, revision = _conv_manager.get_history_with_revision(session_id)
    if not messages:
        raise HTTPException(status_code=404, detail="session_not_found")
    return SessionHistoryResponse(
        session_id=session_id, feature="coding", revision=revision, messages=messages
    )
