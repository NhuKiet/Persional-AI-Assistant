import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from backend.app.core.auth import guest_model, is_guest
from backend.app.core.config import settings
from backend.app.core.rate_limit import rate_limit
from backend.app.shared.conversation_store import ConversationManager
from backend.app.shared.guest_store import guest_sessions
from backend.app.features.chat.schemas import ChatRequest, SessionHistoryResponse
from backend.app.features.chat.service import ChatService, SessionBusyError
from backend.app.shared.session_locks import log_concurrent_rejection
from backend.app.shared.latency import timed
from backend.app.shared.model_guard import require_allowed_model
from backend.app.shared.sse import LeasedStreamingResponse, sse


logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])

_conv_manager = ConversationManager()
_service = ChatService(conversations=_conv_manager)
# Guests: same service, memory-only history under its own namespace — nothing
# a guest types reaches the database or the owner's sessions.
_guest_service = ChatService(conversations=ConversationManager(namespace="guest-chat", store=guest_sessions))


@router.post("/api/chat/stream", dependencies=[Depends(rate_limit("expensive"))])
async def chat_stream(req: ChatRequest, request: Request):
    """Streaming chat with session memory + optional summary context."""
    service = _service
    if is_guest(request):
        service = _guest_service
        req.provider, req.model = guest_model()
    if len(req.message) + len(req.context) > settings.MAX_MESSAGE_CHARS:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Nội dung quá dài (giới hạn {settings.MAX_MESSAGE_CHARS} ký tự)."
            ),
        )
    require_allowed_model(req.provider, req.model)

    try:
        lock = service.begin_session(req.session_id)
    except SessionBusyError:
        log_concurrent_rejection(logger, "chat", req.session_id)
        return JSONResponse(status_code=409, content={"detail": "session_busy"})

    async def generate():
        try:
            async for event in timed("chat", service.stream(req)):
                yield sse(event)
        except Exception as e:
            logger.error(f"Chat stream error: {e}")
            yield sse({"type": "error", "message": str(e)})
        finally:
            service.end_session(lock)

    return LeasedStreamingResponse(
        generate(),
        lease=lock,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# Plain `def`, not `async def`: the history store is synchronous psycopg, so
# FastAPI must run this on its threadpool (tests/test_event_loop_blocking.py).
@router.delete("/api/chat/session/{session_id}")
def clear_session(session_id: str):
    """Clear chat history for a session."""
    _conv_manager.clear_session(session_id)
    return {"cleared": session_id}


@router.get("/api/chat/sessions/{session_id}", response_model=SessionHistoryResponse)
def get_chat_session_history(session_id: str):
    """Read-only session history restore. Never touches the session lock."""
    messages, revision = _conv_manager.get_history_with_revision(session_id)
    if not messages:
        raise HTTPException(status_code=404, detail="session_not_found")
    return SessionHistoryResponse(
        session_id=session_id, feature="chat", revision=revision, messages=messages
    )
