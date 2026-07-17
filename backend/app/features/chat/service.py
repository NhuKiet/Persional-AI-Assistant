from collections.abc import AsyncIterator

from backend.app.core.config import settings
from backend.app.shared.conversation_store import ConversationManager
from backend.app.features.chat.prompts import prompt_for
from backend.app.features.chat.schemas import ChatRequest


class ChatService:
    def __init__(self, conversations: ConversationManager | None = None):
        self._conversations = conversations or ConversationManager()

    async def stream(self, request: ChatRequest) -> AsyncIterator[dict]:
        if len(request.message) + len(request.context) > settings.MAX_MESSAGE_CHARS:
            raise ValueError("message exceeds MAX_MESSAGE_CHARS")

        system = prompt_for(request.tool, request.context)
        async for token in self._conversations.chat_stream(
            session_id=request.session_id,
            message=request.message,
            system=system,
            provider=request.provider,
            model=request.model,
        ):
            yield {"type": "token", "content": token}
