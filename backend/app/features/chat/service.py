import logging
import threading
from collections.abc import AsyncIterator

from backend.app.core.config import settings
from backend.app.shared.conversation_store import ConversationManager, StorageUnavailableError
from backend.app.features.chat.prompts import prompt_for
from backend.app.features.chat.schemas import ChatRequest
from backend.app.shared.session_locks import KeyedLockRegistry, SessionBusyError

__all__ = ["ChatService", "SessionBusyError"]

logger = logging.getLogger(__name__)

# Same shape as research's storage error, so every feature reports a dead
# history DB the same way. Two wordings: before the answer nothing was sent;
# after it the answer is on screen and only saving it failed.
_STORAGE_ERROR = {
    "type": "error", "code": "storage_unavailable",
    "message": "Không thể kết nối kho lịch sử — kiểm tra database rồi thử lại.",
}
_SAVE_ERROR = {
    "type": "error", "code": "storage_unavailable",
    "message": "Câu trả lời chưa được lưu vào lịch sử — không kết nối được database.",
}


class ChatService:
    def __init__(self, conversations: ConversationManager | None = None):
        self._conversations = conversations or ConversationManager()
        # Single-worker only — see backend/app/shared/session_locks.py.
        self._locks = KeyedLockRegistry()

    def begin_session(self, session_id: str) -> threading.Lock:
        """Reserve exclusive mutation rights for a session for the lifetime of
        one stream. Raises SessionBusyError if another stream already holds it."""
        lock = self._locks.try_acquire(session_id)
        if lock is None:
            raise SessionBusyError(session_id)
        return lock

    def end_session(self, lock: threading.Lock) -> None:
        self._locks.release(lock)

    async def stream(self, request: ChatRequest) -> AsyncIterator[dict]:
        if len(request.message) + len(request.context) > settings.MAX_MESSAGE_CHARS:
            raise ValueError("message exceeds MAX_MESSAGE_CHARS")

        system = prompt_for(request.tool, request.context)
        answered = False
        try:
            async for token in self._conversations.chat_stream(
                session_id=request.session_id,
                message=request.message,
                system=system,
                provider=request.provider,
                model=request.model,
                replace_last=request.replace_last,
            ):
                answered = True
                yield {"type": "token", "content": token}
        except StorageUnavailableError as e:
            logger.error("[STORAGE] chat history unavailable: %s", e, exc_info=True)
            yield _SAVE_ERROR if answered else _STORAGE_ERROR
