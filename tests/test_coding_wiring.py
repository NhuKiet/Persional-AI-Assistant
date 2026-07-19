import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import backend.app.features.coding.router as coding_router
import backend.app.features.coding.service as ca
from backend.app.features.coding.artifacts import ArtifactService
from backend.app.features.coding.execution import SANDBOX_DIR
from backend.app.features.coding.service import CodingAgent, CodingConversationManager


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
        unavailable = False

    monkeypatch.setattr(agent.executor, "run", lambda code, sandbox=None, session_id=None: _FakeResult())

    events = list(agent.run(
        "write hello world", [], "test-session",
        provider="openai", model="gpt-4o",
    ))

    assert any(e.get("type") == "done" and e.get("success") for e in events)
    assert calls, "expected at least one model call site to be invoked"
    for call in calls:
        assert call["provider"] == "openai", call
        assert call["model"] == "gpt-4o", call


def _client():
    app = FastAPI()
    app.include_router(coding_router.router)
    return TestClient(app)


# ── ArtifactService routes through validate_relative_path ───────────────────

def test_artifact_service_resolve_rejects_backslash_traversal():
    svc = ArtifactService()
    with pytest.raises(HTTPException) as exc_info:
        svc.resolve("wiring-sess", "..\\..\\secret.png")
    assert exc_info.value.status_code in (400, 403)


def test_artifact_service_resolve_root_rejects_traversal():
    svc = ArtifactService()
    with pytest.raises(HTTPException) as exc_info:
        svc.resolve_root("../evil.png")
    assert exc_info.value.status_code in (400, 403)


def test_artifact_service_resolve_root_rejects_nested_session_path():
    """resolve_root is scoped to SANDBOX_DIR itself, which is the shared
    parent of every session's subdirectory (see session_sandbox() in
    uploads.py). A filename like "other-session/secret.png" has no `..`,
    no backslash, no drive prefix, and resolves under SANDBOX_DIR, so it
    would otherwise pass validate_relative_path and reach into a different
    session's directory. resolve_root must reject any nested path itself,
    not rely on route-level segment restrictions to catch it."""
    other_session = "wiring-nested-victim"
    sdir = SANDBOX_DIR / other_session
    sdir.mkdir(parents=True, exist_ok=True)
    secret = sdir / "secret.png"
    secret.write_bytes(b"\x89PNG\r\n\x1a\n")
    try:
        svc = ArtifactService()
        with pytest.raises(HTTPException) as exc_info:
            svc.resolve_root(f"{other_session}/secret.png")
        assert exc_info.value.status_code == 400
    finally:
        secret.unlink(missing_ok=True)
        sdir.rmdir()


def test_artifact_service_resolve_rejects_disallowed_suffix(tmp_path):
    session = "wiring-suffix-sess"
    sdir = SANDBOX_DIR / session
    sdir.mkdir(parents=True, exist_ok=True)
    target = sdir / "notes.txt"
    target.write_text("hi", encoding="utf-8")
    try:
        svc = ArtifactService()
        with pytest.raises(HTTPException) as exc_info:
            svc.resolve(session, "notes.txt")
        assert exc_info.value.status_code == 400
    finally:
        target.unlink(missing_ok=True)
        sdir.rmdir()


# ── Router serves html/svg as forced-download attachments ───────────────────

def test_serve_session_artifact_forces_attachment_for_html():
    session = "wiring-html-sess"
    sdir = SANDBOX_DIR / session
    sdir.mkdir(parents=True, exist_ok=True)
    target = sdir / "report.html"
    target.write_text("<h1>hi</h1>", encoding="utf-8")
    try:
        app = FastAPI()
        app.include_router(coding_router.router)
        client = TestClient(app)
        resp = client.get(f"/api/coding/artifact/{session}/report.html")
        assert resp.status_code == 200
        assert resp.headers["content-disposition"].startswith("attachment")
        assert resp.headers["x-content-type-options"] == "nosniff"
    finally:
        target.unlink(missing_ok=True)
        sdir.rmdir()


# ── Session history restore + concurrency lock ──────────────────────────────

def test_get_sessions_history_returns_expected_shape(monkeypatch, tmp_path):
    monkeypatch.setattr(ca, "_sessions", ca._CodingSessionStore(tmp_path / "s.db"))
    coding_router._conv_manager.add_turn("hist-1", role="user", content="hi")
    coding_router._conv_manager.add_turn("hist-1", role="assistant", content="hello")

    r = _client().get("/api/coding/sessions/hist-1")

    assert r.status_code == 200
    body = r.json()
    assert body == {
        "session_id": "hist-1",
        "feature": "coding",
        "revision": 2,
        "messages": [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello"},
        ],
    }


def test_get_sessions_history_404_when_unknown(monkeypatch, tmp_path):
    monkeypatch.setattr(ca, "_sessions", ca._CodingSessionStore(tmp_path / "s.db"))
    r = _client().get("/api/coding/sessions/never-existed")
    assert r.status_code == 404


def test_delete_coding_session_removes_exact_history(monkeypatch, tmp_path):
    monkeypatch.setattr(ca, "_sessions", ca._CodingSessionStore(tmp_path / "s.db"))
    coding_router._conv_manager.add_turn("del-1", role="user", content="hi")

    r = _client().delete("/api/coding/session/del-1")
    assert r.status_code == 200

    messages, revision = coding_router._conv_manager.get_history_with_revision("del-1")
    assert messages == []
    assert revision == 0


def test_coding_second_stream_while_active_returns_409():
    lock = coding_router._service.begin_session("race-1")
    try:
        r = _client().post(
            "/api/coding/stream",
            json={"message": "hi", "session_id": "race-1"},
        )
        assert r.status_code == 409
        assert r.json() == {"detail": "session_busy"}
    finally:
        coding_router._service.end_session(lock)
