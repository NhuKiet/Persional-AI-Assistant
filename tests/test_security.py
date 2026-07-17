"""Security / API-boundary regression tests.

Bao ve cac fix trong dot P0/P1: chan path traversal, gioi han tai, cach ly
upload theo session, tat auto-install, va khong ro ri secret ra code sinh.
Comment giu ASCII de tranh loi encoding.
"""
import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api_chat
from backend.app.features.coding import router as coding_router
from backend.app.features.pdf import router as pdf_router
from backend.app.core.config import settings


def _client(router):
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


# ── PDF path traversal: stream + summarize phai chan filename doc hai ────────

@pytest.mark.parametrize("bad", ["../../.env", "..\\..\\secret", "sub/x.pdf"])
def test_pdf_stream_rejects_traversal(bad):
    r = _client(pdf_router.router).post("/api/pdf/stream",
                                     json={"message": "hi", "filename": bad})
    assert r.status_code == 400


@pytest.mark.parametrize("bad", ["../../.env", "..\\secret", "a/b"])
def test_pdf_summarize_rejects_traversal(bad):
    r = _client(pdf_router.router).post("/api/pdf/summarize",
                                     json={"filename": bad})
    assert r.status_code == 400


# ── Gioi han do dai message (chi phi/token) ─────────────────────────────────

def test_chat_rejects_oversized_message():
    huge = "x" * (settings.MAX_MESSAGE_CHARS + 1)
    r = _client(api_chat.router).post("/api/chat/stream", json={"message": huge})
    assert r.status_code == 413


def test_coding_rejects_oversized_message():
    huge = "x" * (settings.MAX_MESSAGE_CHARS + 1)
    r = _client(coding_router.router).post("/api/coding/stream", json={"message": huge})
    assert r.status_code == 413


# ── Coding upload: cach ly theo session + gioi han kich thuoc + traversal ────

def test_coding_upload_rejects_traversal():
    r = _client(coding_router.router).post(
        "/api/coding/upload",
        files={"file": ("../evil.csv", b"a,b\n1,2\n", "text/csv")},
        data={"session_id": "sec-sess"},
    )
    assert r.status_code == 400


def test_coding_upload_rejects_oversize(monkeypatch):
    monkeypatch.setattr(settings, "MAX_UPLOAD_MB", 0, raising=False)
    r = _client(coding_router.router).post(
        "/api/coding/upload",
        files={"file": ("big.csv", b"a" * 1024, "text/csv")},
        data={"session_id": "sec-sess"},
    )
    assert r.status_code == 413


def test_coding_upload_lands_in_session_sandbox():
    from backend.app.features.coding.execution import SANDBOX_DIR
    from backend.app.features.coding.service import _session_sandbox

    sess  = "sec-isolation-test"
    fname = "sec_upload.csv"
    sdir  = _session_sandbox(sess)
    shared = SANDBOX_DIR / fname
    target = sdir / fname
    for p in (shared, target):
        if p.exists():
            p.unlink()
    try:
        r = _client(coding_router.router).post(
            "/api/coding/upload",
            files={"file": (fname, b"a,b\n1,2\n", "text/csv")},
            data={"session_id": sess},
        )
        assert r.status_code == 200
        # Vao sandbox rieng cua session, KHONG vao thu muc chung.
        assert target.exists()
        assert not shared.exists()
    finally:
        if target.exists():
            target.unlink()


# ── Auto-install tat mac dinh (khong cai package vao env may chu) ────────────

def test_auto_install_disabled_by_default():
    assert settings.ENABLE_AUTO_INSTALL is False
    import backend.app.features.coding.service as ca
    assert ca.ENABLE_AUTO_INSTALL is False


# ── Executor khong ro ri secret cua server ra code do LLM sinh ──────────────

def test_executor_hides_server_secrets(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "SECRET_must_not_leak")
    monkeypatch.setenv("TAVILY_API_KEY", "SECRET_tavily")
    from backend.app.features.coding.execution import CodeExecutor

    r = CodeExecutor().run(
        'import os; print(os.environ.get("ANTHROPIC_API_KEY"));'
        ' print(os.environ.get("TAVILY_API_KEY"))'
    )
    assert "SECRET_must_not_leak" not in r.stdout
    assert "SECRET_tavily" not in r.stdout
    assert "None" in r.stdout  # bien khong ton tai trong env sandbox


def test_executor_timeout_kills_runaway():
    from backend.app.features.coding.execution import CodeExecutor
    r = CodeExecutor().run("while True: pass", timeout=2)
    assert r.timed_out and r.exit_code == -1
