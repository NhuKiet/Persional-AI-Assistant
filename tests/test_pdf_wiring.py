import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

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
