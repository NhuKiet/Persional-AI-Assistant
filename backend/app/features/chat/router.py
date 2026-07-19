import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse

from backend.app.core.config import settings
from backend.app.shared.conversation_store import ConversationManager
from backend.app.features.chat.schemas import ChatRequest, SessionHistoryResponse
from backend.app.features.chat.service import ChatService, SessionBusyError
from backend.app.shared.session_locks import log_concurrent_rejection
from backend.app.shared.sse import sse


logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])

_conv_manager = ConversationManager()
_service = ChatService(conversations=_conv_manager)


@router.post("/api/chat/stream")
async def chat_stream(req: ChatRequest):
    """Streaming chat with session memory + optional summary context."""
    if len(req.message) + len(req.context) > settings.MAX_MESSAGE_CHARS:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Nội dung quá dài (giới hạn {settings.MAX_MESSAGE_CHARS} ký tự)."
            ),
        )

    try:
        lock = _service.begin_session(req.session_id)
    except SessionBusyError:
        log_concurrent_rejection(logger, "chat", req.session_id)
        return JSONResponse(status_code=409, content={"detail": "session_busy"})

    async def generate():
        try:
            async for event in _service.stream(req):
                yield sse(event)
        except Exception as e:
            logger.error(f"Chat stream error: {e}")
            yield sse({"type": "error", "message": str(e)})
        finally:
            _service.end_session(lock)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.delete("/api/chat/session/{session_id}")
async def clear_session(session_id: str):
    """Clear chat history for a session."""
    _conv_manager.clear_session(session_id)
    return {"cleared": session_id}


@router.get("/api/chat/sessions/{session_id}", response_model=SessionHistoryResponse)
async def get_chat_session_history(session_id: str):
    """Read-only session history restore. Never touches the session lock."""
    messages, revision = _conv_manager.get_history_with_revision(session_id)
    if not messages:
        raise HTTPException(status_code=404, detail="session_not_found")
    return SessionHistoryResponse(
        session_id=session_id, feature="chat", revision=revision, messages=messages
    )
