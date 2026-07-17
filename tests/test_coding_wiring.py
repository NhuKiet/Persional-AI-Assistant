import backend.app.features.coding.service as ca
from backend.app.features.coding.service import CodingAgent


def test_stream_ollama_uses_stream_chat(monkeypatch):
    captured = {}

    def fake_stream_chat(messages, system="", provider=None, model=None, temperature=0.1):
        captured["provider"] = provider
        captured["model"] = model
        yield "x"

    monkeypatch.setattr(ca, "stream_chat", fake_stream_chat)
    out = list(ca._stream_ollama("prompt", "SYS", provider="openai", model="gpt-4o"))
    assert out == ["x"]
    assert captured == {"provider": "openai", "model": "gpt-4o"}


def test_chat_propagates_provider_and_model(monkeypatch):
    """CodingAgent.chat(...) must forward provider/model to _stream_ollama."""
    captured = {}

    def fake_stream_ollama(prompt, system=ca.SYSTEM_PROMPT, provider=None, model=None):
        captured["provider"] = provider
        captured["model"] = model
        captured["system"] = system
        yield "hello"

    monkeypatch.setattr(ca, "_stream_ollama", fake_stream_ollama)

    agent = CodingAgent()
    out = list(agent.chat(
        "hi", [], provider="anthropic", model="claude-sonnet-5",
    ))

    assert out == ["hello"]
    assert captured["provider"] == "anthropic"
    assert captured["model"] == "claude-sonnet-5"
    assert captured["system"] == ca.CHAT_SYSTEM


def test_run_propagates_provider_and_model_to_plan_call(monkeypatch):
    """CodingAgent.run(...) must forward provider/model to the internal
    _call_ollama/_stream_ollama call sites. We only need to drive the run()
    generator far enough to hit the FIRST model call (the planning step),
    which is enough to prove the parameters flow through without exercising
    the whole agent (code execution, debug loop, tests, review)."""
    calls = []

    def fake_call_ollama(prompt, system=ca.SYSTEM_PROMPT, provider=None, model=None):
        calls.append({"fn": "_call_ollama", "provider": provider, "model": model})
        # Return a minimal valid plan JSON so _parse_plan succeeds.
        return '[{"step": 1, "title": "t", "description": "d"}]'

    def fake_stream_ollama(prompt, system=ca.SYSTEM_PROMPT, provider=None, model=None):
        calls.append({"fn": "_stream_ollama", "provider": provider, "model": model})
        # Yield a trivial one-file code block so run() can proceed past
        # code generation; the executor is stubbed below so it never
        # actually runs anything.
        yield "```python\nprint('hi')\n```"

    monkeypatch.setattr(ca, "_call_ollama", fake_call_ollama)
    monkeypatch.setattr(ca, "_stream_ollama", fake_stream_ollama)

    agent = CodingAgent()

    class _FakeResult:
        stdout = "hi\n"
        stderr = ""
        exit_code = 0
        timed_out = False
        duration = 0.01
        success = True

    monkeypatch.setattr(agent.executor, "run", lambda code, sandbox: _FakeResult())

    events = list(agent.run(
        "write hello world", [], "test-session",
        provider="openai", model="gpt-4o",
    ))

    assert any(e.get("type") == "done" and e.get("success") for e in events)
    assert calls, "expected at least one model call site to be invoked"
    for call in calls:
        assert call["provider"] == "openai", call
        assert call["model"] == "gpt-4o", call
