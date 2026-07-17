import asyncio

import backend.app.shared.conversation_store as conv_mod
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
