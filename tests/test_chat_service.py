import asyncio

import pytest

from backend.app.features.chat.schemas import ChatRequest
from backend.app.features.chat.service import ChatService
from backend.app.shared.conversation_store import ConversationManager
from backend.app.shared.session_locks import SessionBusyError
from tests.fake_session_store import FakeSessionStore


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

    monkeypatch.setattr(conv_mod, "_store", FakeSessionStore())
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

    monkeypatch.setattr(conv_mod, "_store", FakeSessionStore())
    mgr = ConversationManager()

    messages, revision = mgr.get_history_with_revision("never-seen")

    assert messages == []
    assert revision == 0


def test_clear_session_removes_history_exactly(monkeypatch, tmp_path):
    import backend.app.shared.conversation_store as conv_mod

    monkeypatch.setattr(conv_mod, "_store", FakeSessionStore())
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


class _DownStore(FakeSessionStore):
    """History store whose reads and/or writes fail the way a dead Postgres
    does (psycopg_pool.PoolTimeout surfaces as a plain Exception subclass)."""

    def __init__(self, *, fail_load=False, fail_save=False):
        super().__init__()
        self._fail_load = fail_load
        self._fail_save = fail_save

    def load_with_revision(self, key):
        if self._fail_load:
            raise RuntimeError("pool initialization incomplete after 3.0 sec")
        return super().load_with_revision(key)

    def save(self, key, messages):
        if self._fail_save:
            raise RuntimeError("pool initialization incomplete after 3.0 sec")
        super().save(key, messages)


def _collect_chat(conversations):
    async def collect():
        return [
            event
            async for event in ChatService(conversations=conversations).stream(
                ChatRequest(message="hello", session_id="s1", tool="chat")
            )
        ]

    return asyncio.run(collect())


def test_history_db_down_before_answer_yields_storage_error_without_calling_llm(monkeypatch):
    import backend.app.shared.conversation_store as conv_mod

    called = False

    async def fake_astream(*_args, **_kwargs):
        nonlocal called
        called = True
        yield "never"

    monkeypatch.setattr(conv_mod, "astream_chat", fake_astream)
    monkeypatch.setattr(conv_mod, "_store", _DownStore(fail_load=True))

    events = _collect_chat(ConversationManager())

    assert called is False
    assert len(events) == 1
    assert events[0]["type"] == "error"
    assert events[0]["code"] == "storage_unavailable"
    # User-facing text, not the raw driver exception.
    assert "pool" not in events[0]["message"]
    assert events[0]["message"].strip()


def test_history_db_down_after_answer_keeps_tokens_then_reports_unsaved(monkeypatch):
    import backend.app.shared.conversation_store as conv_mod

    async def fake_astream(*_args, **_kwargs):
        yield "2 + 2 = 4."

    monkeypatch.setattr(conv_mod, "astream_chat", fake_astream)
    monkeypatch.setattr(conv_mod, "_store", _DownStore(fail_save=True))

    events = _collect_chat(ConversationManager())

    assert events[0] == {"type": "token", "content": "2 + 2 = 4."}
    assert len(events) == 2
    assert events[1]["type"] == "error"
    assert events[1]["code"] == "storage_unavailable"
    assert "pool" not in events[1]["message"]
    # Different wording from the "could not start" case: the answer is shown,
    # only persisting it failed.
    before = _collect_chat_down_before(monkeypatch)
    assert events[1]["message"] != before["message"]


def _collect_chat_down_before(monkeypatch):
    import backend.app.shared.conversation_store as conv_mod

    monkeypatch.setattr(conv_mod, "_store", _DownStore(fail_load=True))
    return _collect_chat(ConversationManager())[0]


def test_llm_error_still_propagates_to_router(monkeypatch):
    """Only storage failures are translated here; an LLM failure keeps its
    existing path (router turns it into an error event with its message)."""
    import backend.app.shared.conversation_store as conv_mod

    async def failing_astream(*_args, **_kwargs):
        raise ValueError("provider unavailable")
        yield  # pragma: no cover

    monkeypatch.setattr(conv_mod, "astream_chat", failing_astream)
    monkeypatch.setattr(conv_mod, "_store", FakeSessionStore())

    with pytest.raises(RuntimeError, match="provider unavailable"):
        _collect_chat(ConversationManager())
