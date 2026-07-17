import pytest

import backend.app.core.llm as llm_mod
from backend.app.core.llm import available_models, get_llm


def test_get_llm_ollama_default(monkeypatch):
    monkeypatch.setattr(llm_mod.settings, "DEFAULT_PROVIDER", "ollama")
    obj = get_llm()
    assert obj.__class__.__name__ == "ChatOllama"


def test_get_llm_anthropic_without_key_raises(monkeypatch):
    monkeypatch.setattr(llm_mod.settings, "ANTHROPIC_API_KEY", None)
    with pytest.raises(ValueError):
        get_llm(provider="anthropic")


def test_get_llm_unknown_provider_raises():
    with pytest.raises(ValueError):
        get_llm(provider="gemini")


def test_available_models_only_configured(monkeypatch):
    monkeypatch.setattr(llm_mod.settings, "ANTHROPIC_API_KEY", None)
    monkeypatch.setattr(llm_mod.settings, "OPENAI_API_KEY", None)
    models = available_models()
    providers = {m["provider"] for m in models}
    assert providers == {"ollama"}
    assert all(set(m.keys()) == {"provider", "model", "label"} for m in models)


def test_available_models_includes_anthropic_when_key(monkeypatch):
    monkeypatch.setattr(llm_mod.settings, "ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setattr(llm_mod.settings, "OPENAI_API_KEY", None)
    providers = {m["provider"] for m in available_models()}
    assert "anthropic" in providers
    assert "openai" not in providers


import asyncio

import backend.app.core.llm as _llm


class _FakeChunk:
    def __init__(self, content):
        self.content = content


class _FakeModel:
    def stream(self, messages):
        for t in ["Xin ", "chào"]:
            yield _FakeChunk(t)

    async def astream(self, messages):
        for t in ["Hello", " world"]:
            yield _FakeChunk(t)

    def invoke(self, messages):
        return _FakeChunk("KETQUA")


def test_stream_chat_yields_tokens(monkeypatch):
    monkeypatch.setattr(_llm, "get_llm", lambda *a, **k: _FakeModel())
    out = list(_llm.stream_chat([{"role": "user", "content": "hi"}]))
    assert out == ["Xin ", "chào"]


def test_astream_chat_yields_tokens(monkeypatch):
    monkeypatch.setattr(_llm, "get_llm", lambda *a, **k: _FakeModel())

    async def _collect():
        return [t async for t in _llm.astream_chat([{"role": "user", "content": "hi"}])]

    assert asyncio.run(_collect()) == ["Hello", " world"]


def test_invoke_chat_returns_text(monkeypatch):
    monkeypatch.setattr(_llm, "get_llm", lambda *a, **k: _FakeModel())
    assert _llm.invoke_chat("hi", system="sys") == "KETQUA"


class _FakeListContentModel:
    """Simulates Anthropic-style content: a list of content-block dicts."""

    _BLOCKS = [{"type": "text", "text": "Hi"}, {"type": "text", "text": " there"}]

    def stream(self, messages):
        for block in self._BLOCKS:
            yield _FakeChunk([block])

    async def astream(self, messages):
        for block in self._BLOCKS:
            yield _FakeChunk([block])

    def invoke(self, messages):
        return _FakeChunk(self._BLOCKS)


def test_stream_chat_normalizes_list_content(monkeypatch):
    monkeypatch.setattr(_llm, "get_llm", lambda *a, **k: _FakeListContentModel())
    out = list(_llm.stream_chat([{"role": "user", "content": "hi"}]))
    assert out == ["Hi", " there"]
    assert all(isinstance(t, str) for t in out)


def test_astream_chat_normalizes_list_content(monkeypatch):
    monkeypatch.setattr(_llm, "get_llm", lambda *a, **k: _FakeListContentModel())

    async def _collect():
        return [t async for t in _llm.astream_chat([{"role": "user", "content": "hi"}])]

    out = asyncio.run(_collect())
    assert out == ["Hi", " there"]
    assert all(isinstance(t, str) for t in out)


def test_invoke_chat_normalizes_list_content(monkeypatch):
    monkeypatch.setattr(_llm, "get_llm", lambda *a, **k: _FakeListContentModel())
    result = _llm.invoke_chat("hi")
    assert result == "Hi there"
    assert isinstance(result, str)
