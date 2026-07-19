import asyncio

from fastapi import FastAPI
from fastapi.testclient import TestClient

import backend.app.shared.conversation_store as conv_mod
import backend.app.features.chat.router as chat_router
from backend.app.shared.conversation_store import ConversationManager


def test_chat_stream_uses_astream_chat(monkeypatch, tmp_path):
    captured = {}

    async def fake_astream(messages, system="", provider=None, model=None, temperature=0.1):
        captured["provider"] = provider
        captured["model"] = model
        for t in ["a", "b"]:
            yield t

    monkeypatch.setattr(conv_mod, "astream_chat", fake_astream)
    monkeypatch.setattr(conv_mod, "_store", conv_mod._SessionStore(tmp_path / "s.db"))

    mgr = ConversationManager()

    async def _collect():
        return [
            t async for t in mgr.chat_stream(
                session_id="t1", message="hi", system="sys",
                provider="anthropic", model="claude-sonnet-5",
            )
        ]

    out = asyncio.run(_collect())
    assert out == ["a", "b"]
    assert captured == {"provider": "anthropic", "model": "claude-sonnet-5"}


def _client():
    app = FastAPI()
    app.include_router(chat_router.router)
    return TestClient(app)


def test_get_session_history_returns_expected_shape(monkeypatch, tmp_path):
    monkeypatch.setattr(conv_mod, "_store", conv_mod._SessionStore(tmp_path / "s.db"))
    chat_router._conv_manager.add_turn("hist-1", role="user", content="hi")
    chat_router._conv_manager.add_turn("hist-1", role="assistant", content="hello")

    r = _client().get("/api/chat/sessions/hist-1")

    assert r.status_code == 200
    body = r.json()
    assert body["session_id"] == "hist-1"
    assert body["feature"] == "chat"
    assert body["revision"] == 2
    assert body["messages"] == [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello"},
    ]


def test_get_session_history_404_when_unknown(monkeypatch, tmp_path):
    monkeypatch.setattr(conv_mod, "_store", conv_mod._SessionStore(tmp_path / "s.db"))
    r = _client().get("/api/chat/sessions/never-existed")
    assert r.status_code == 404


def test_delete_session_removes_exact_history(monkeypatch, tmp_path):
    monkeypatch.setattr(conv_mod, "_store", conv_mod._SessionStore(tmp_path / "s.db"))
    chat_router._conv_manager.add_turn("del-1", role="user", content="hi")

    r = _client().delete("/api/chat/session/del-1")
    assert r.status_code == 200

    messages, revision = chat_router._conv_manager.get_history_with_revision("del-1")
    assert messages == []
    assert revision == 0


def test_second_stream_while_active_returns_409(monkeypatch):
    lock = chat_router._service.begin_session("race-1")
    try:
        r = _client().post(
            "/api/chat/stream",
            json={"message": "hi", "session_id": "race-1"},
        )
        assert r.status_code == 409
        assert r.json() == {"detail": "session_busy"}
    finally:
        chat_router._service.end_session(lock)
