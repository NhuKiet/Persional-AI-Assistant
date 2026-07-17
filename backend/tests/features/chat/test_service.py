import asyncio

from backend.app.features.chat.schemas import ChatRequest
from backend.app.features.chat.service import ChatService


def test_chat_service_emits_current_token_event_shape():
    class StubConversations:
        async def chat_stream(self, **_kwargs):
            yield "xin chào"

    async def collect():
        return [
            event
            async for event in ChatService(conversations=StubConversations()).stream(
                ChatRequest(message="hello", session_id="s1", tool="chat")
            )
        ]

    events = asyncio.run(collect())

    assert events == [{"type": "token", "content": "xin chào"}]
