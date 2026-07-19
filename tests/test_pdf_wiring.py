import asyncio

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import backend.app.shared.conversation_store as conv_mod
import backend.app.features.pdf.router as pdf_router
import backend.app.features.pdf.service as pdf_service


def _client():
    app = FastAPI()
    app.include_router(pdf_router.router)
    return TestClient(app)


def test_stream_llm_passes_provider(monkeypatch):
    captured = {}

    def fake_stream_chat(messages, system="", provider=None, model=None, temperature=0.1):
        captured["provider"] = provider
        captured["model"] = model
        captured["system"] = system
        yield "tok"

    monkeypatch.setattr(pdf_service, "stream_chat", fake_stream_chat)
    out = list(pdf_router._service._stream_llm(
        [{"role": "user", "content": "hi"}], "SYS",
        provider="openai", model="gpt-4o-mini",
    ))
    assert out == ["tok"]
    assert captured == {"provider": "openai", "model": "gpt-4o-mini", "system": "SYS"}


# ── Chan path traversal ──────────────────────────────────────────────────────
# Goi thang _check_filename: qua HTTP, mot payload chua "/" bi routing cua
# FastAPI tu tra 404 TRUOC khi vao handler, nen test se xanh ma khong he chay
# qua nhanh validate.

@pytest.mark.parametrize("bad", [
    "../secret.pdf",     # luat ".."
    "..\\secret.pdf",    # luat ".."
    "sub/dir.pdf",       # luat "/"
    "sub\\dir.pdf",      # CHI luat "\" bat duoc: khong co ".." lan "/"
    "a..b.pdf",
    "",
    None,
])
def test_check_filename_rejects(bad):
    with pytest.raises(HTTPException) as e:
        pdf_router._check_filename(bad)
    assert e.value.status_code == 400


def test_check_filename_accepts_normal_name():
    assert pdf_router._check_filename("bao cao 2026.pdf") == "bao cao 2026.pdf"


def test_raw_missing_file_is_404():
    r = _client().get("/api/pdf/raw/khong-ton-tai.pdf")
    assert r.status_code == 404


# ── Vision guard ─────────────────────────────────────────────────────────────

def _stream(client, **body):
    return client.post("/api/pdf/stream", json={"filename": "x.pdf", **body})


def test_stream_image_pin_with_ollama_errors(monkeypatch):
    monkeypatch.setattr(pdf_router.settings, "DEFAULT_PROVIDER", "ollama", raising=False)
    r = _stream(_client(), message="cai nay la gi",
                pins=[{"type": "image", "page": 1, "data_url": "data:image/jpeg;base64,AAA"}])
    assert r.status_code == 200
    assert '"type": "error"' in r.text
    assert "llama3" in r.text or "Claude" in r.text


def test_guard_is_case_insensitive_about_provider(monkeypatch):
    """Provider duoc chuan hoa bang .lower() truoc khi so sanh."""
    monkeypatch.setattr(pdf_router.settings, "DEFAULT_PROVIDER", "openai", raising=False)
    r = _stream(_client(), message="hi", provider="OLLAMA",
                pins=[{"type": "image", "page": 1, "data_url": "data:image/jpeg;base64,AAA"}])
    assert '"type": "error"' in r.text
    assert "llama3" in r.text or "Claude" in r.text


def test_text_pin_with_ollama_passes_guard(monkeypatch):
    """Pin text khong dinh gi den vision => guard KHONG duoc chan."""
    monkeypatch.setattr(pdf_router.settings, "DEFAULT_PROVIDER", "ollama", raising=False)
    monkeypatch.setattr(pdf_router._service, "_get_doc", lambda f: object())
    monkeypatch.setattr(pdf_router._service._processor, "build_context", lambda doc, q: "CTX")
    monkeypatch.setattr(pdf_router._service, "_stream_llm",
                        lambda *a, **k: iter(["ok"]))
    r = _stream(_client(), message="giai thich",
                pins=[{"type": "text", "page": 1, "text": "doan van"}])
    assert "Claude hoac GPT-4o" not in r.text
    assert '"type": "token"' in r.text


def test_no_pins_with_ollama_passes_guard(monkeypatch):
    monkeypatch.setattr(pdf_router.settings, "DEFAULT_PROVIDER", "ollama", raising=False)
    monkeypatch.setattr(pdf_router._service, "_get_doc", lambda f: object())
    monkeypatch.setattr(pdf_router._service._processor, "build_context", lambda doc, q: "CTX")
    monkeypatch.setattr(pdf_router._service, "_stream_llm", lambda *a, **k: iter(["ok"]))
    r = _stream(_client(), message="tom tat")
    assert '"type": "token"' in r.text


# ── History restore + concurrency lock ──────────────────────────────────────

def test_get_pdf_session_history_returns_expected_shape(monkeypatch, tmp_path):
    monkeypatch.setattr(conv_mod, "_store", conv_mod._SessionStore(tmp_path / "s.db"))
    pdf_router._service._conv_manager.add_turn("hist-1", role="user", content="hi")
    pdf_router._service._conv_manager.add_turn("hist-1", role="assistant", content="hello")

    r = _client().get("/api/pdf/sessions/hist-1")

    assert r.status_code == 200
    body = r.json()
    assert body == {
        "session_id": "hist-1",
        "feature": "pdf",
        "revision": 2,
        "messages": [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello"},
        ],
    }


def test_get_pdf_session_history_404_when_unknown(monkeypatch, tmp_path):
    monkeypatch.setattr(conv_mod, "_store", conv_mod._SessionStore(tmp_path / "s.db"))
    r = _client().get("/api/pdf/sessions/never-existed")
    assert r.status_code == 404


def test_pdf_second_stream_while_active_returns_409():
    lock = pdf_router._service.begin_session("race-1")
    try:
        r = _stream(_client(), message="hi", session_id="race-1")
        assert r.status_code == 409
        assert r.json() == {"detail": "session_busy"}
    finally:
        pdf_router._service.end_session(lock)


def test_pdf_summarize_while_chat_active_returns_409():
    """chat and summarize share one lock per session_id — only one may mutate."""
    lock = pdf_router._service.begin_session("race-2")
    try:
        r = _client().post(
            "/api/pdf/summarize",
            json={"filename": "x.pdf", "session_id": "race-2"},
        )
        assert r.status_code == 409
        assert r.json() == {"detail": "session_busy"}
    finally:
        pdf_router._service.end_session(lock)


# ── Session-scoped delete (Task 4 session model) ────────────────────────────
# Xoá conversation phải theo session_id — KHÔNG theo filename. Hai session
# khác nhau có thể mở cùng một filename; xoá theo filename sẽ xoá luôn hội
# thoại của session kia.

def test_delete_pdf_clears_conversation_by_session_id_not_filename(monkeypatch):
    cleared = {}
    monkeypatch.setattr(
        pdf_router._service._conv_manager, "clear_session",
        lambda session_id: cleared.setdefault("session_id", session_id),
    )
    monkeypatch.setattr(pdf_router._repository, "delete", lambda filename: None)

    r = _client().request(
        "DELETE", "/api/pdf/file/report.pdf", params={"session_id": "session-A"},
    )

    assert r.status_code == 200
    assert cleared["session_id"] == "session-A"
    assert cleared["session_id"] != "report.pdf"


def test_delete_pdf_does_not_touch_other_sessions_conversation(monkeypatch, tmp_path):
    """Regression for the filename-as-session-id bug: two sessions sharing a
    filename must not be able to wipe each other's chat history."""
    from backend.app.shared.conversation_store import ConversationManager

    monkeypatch.setattr(conv_mod, "_store", conv_mod._SessionStore(tmp_path / "s.db"))
    conv = ConversationManager(namespace="pdf")
    conv.add_turn("session-A", role="user", content="hello from A")
    conv.add_turn("session-B", role="user", content="hello from B")
    monkeypatch.setattr(pdf_router._service, "_conv_manager", conv)
    monkeypatch.setattr(pdf_router._repository, "delete", lambda filename: None)

    r = _client().request(
        "DELETE", "/api/pdf/file/shared.pdf", params={"session_id": "session-A"},
    )

    assert r.status_code == 200
    assert conv.get_history("session-A") == []
    assert conv.get_history("session-B") != []   # untouched


# ── Declared-size rejection before read() ───────────────────────────────────

def test_upload_rejects_oversized_file_by_declared_size_without_reading():
    """UploadFile.size (known once multipart parsing finishes) must be
    checked BEFORE calling file.read() — an oversized upload should never be
    materialized into an in-memory bytes object just to be thrown away."""
    read_calls = {"n": 0}

    class _FakeUploadFile:
        filename = "big.pdf"
        size = 51 * 1024 * 1024

        async def read(self):
            read_calls["n"] += 1
            return b"x" * self.size

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(pdf_router.upload_pdf(file=_FakeUploadFile()))

    assert exc_info.value.status_code == 400
    assert read_calls["n"] == 0
