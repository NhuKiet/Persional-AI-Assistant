import asyncio

import pytest

from backend.app.features.chat.schemas import ChatRequest
from backend.app.features.chat.service import ChatService
from backend.app.shared.conversation_store import ConversationManager
from backend.app.shared.session_locks import SessionBusyError


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


def test_history_serialization_preserves_order(monkeypatch, tmp_path):
    import backend.app.shared.conversation_store as conv_mod

    monkeypatch.setattr(conv_mod, "_store", conv_mod._SessionStore(tmp_path / "s.db"))
    mgr = ConversationManager()

    mgr.add_turn("sess-1", role="user", content="one")
    mgr.add_turn("sess-1", role="assistant", content="two")
    mgr.add_turn("sess-1", role="user", content="three")

    messages, revision = mgr.get_history_with_revision("sess-1")

    assert messages == [
        {"role": "user", "content": "one"},
        {"role": "assistant", "content": "two"},
        {"role": "user", "content": "three"},
    ]
    assert revision == 3


def test_history_revision_zero_for_unknown_session(monkeypatch, tmp_path):
    import backend.app.shared.conversation_store as conv_mod

    monkeypatch.setattr(conv_mod, "_store", conv_mod._SessionStore(tmp_path / "s.db"))
    mgr = ConversationManager()

    messages, revision = mgr.get_history_with_revision("never-seen")

    assert messages == []
    assert revision == 0


def test_clear_session_removes_history_exactly(monkeypatch, tmp_path):
    import backend.app.shared.conversation_store as conv_mod

    monkeypatch.setattr(conv_mod, "_store", conv_mod._SessionStore(tmp_path / "s.db"))
    mgr = ConversationManager()
    mgr.add_turn("sess-2", role="user", content="hi")

    mgr.clear_session("sess-2")

    messages, revision = mgr.get_history_with_revision("sess-2")
    assert messages == []
    assert revision == 0


def test_chat_service_second_stream_while_active_raises_session_busy():
    service = ChatService(conversations=ConversationManager())
    lock = service.begin_session("busy-session")
    try:
        with pytest.raises(SessionBusyError):
            service.begin_session("busy-session")
    finally:
        service.end_session(lock)

    # Released — a subsequent begin succeeds.
    lock2 = service.begin_session("busy-session")
    service.end_session(lock2)
