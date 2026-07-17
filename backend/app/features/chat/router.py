import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from backend.app.core.config import settings
from backend.app.shared.conversation_store import ConversationManager
from backend.app.features.chat.schemas import ChatRequest
from backend.app.features.chat.service import ChatService
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

    async def generate():
        try:
            async for event in _service.stream(req):
                yield sse(event)
        except Exception as e:
            logger.error(f"Chat stream error: {e}")
            yield sse({"type": "error", "message": str(e)})

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
