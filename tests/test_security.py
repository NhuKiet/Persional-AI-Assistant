"""Security / API-boundary regression tests.

Bao ve cac fix trong dot P0/P1: chan path traversal, gioi han tai, cach ly
upload theo session, tat auto-install, va khong ro ri secret ra code sinh.
Comment giu ASCII de tranh loi encoding.
"""
import os

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.app.features.chat.router import router as _chat_router
from backend.app.features.coding import router as coding_router
from backend.app.features.coding.artifacts import artifact_response, validate_relative_path
from backend.app.features.coding.execution import SANDBOX_DIR
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
    r = _client(_chat_router).post("/api/chat/stream", json={"message": huge})
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
#
# Executor la Docker-only (xem backend/app/features/coding/execution.py):
# khong con host-subprocess fallback nen khong the "chay that" trong test
# nay ma khong co Docker daemon. Thay vao do kiem tra o muc dispatch/argv —
# dam bao pipeline thuc te (khong chi ham argv builder don le) khong bao
# gio dua secret cua server vao container.

def test_executor_hides_server_secrets(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "SECRET_must_not_leak")
    monkeypatch.setenv("TAVILY_API_KEY", "SECRET_tavily")
    import backend.app.features.coding.execution as ce

    monkeypatch.setattr(ce, "_docker_available", lambda: True)
    captured = {}

    def fake_run_docker(self, script_path, run_dir, timeout):
        captured["argv"] = ce._docker_run_argv(script_path.name, run_dir, "king-exec-test")
        return ce.ExecutionResult(stdout="", stderr="", exit_code=0, timed_out=False, duration=0.0)

    monkeypatch.setattr(ce.CodeExecutor, "_run_docker", fake_run_docker)
    ce.CodeExecutor().run(
        'import os; print(os.environ.get("ANTHROPIC_API_KEY"));'
        ' print(os.environ.get("TAVILY_API_KEY"))'
    )

    joined = " ".join(captured["argv"])
    assert "SECRET_must_not_leak" not in joined
    assert "SECRET_tavily" not in joined
    assert "ANTHROPIC_API_KEY" not in joined
    assert "TAVILY_API_KEY" not in joined


def test_executor_timeout_kills_container_and_reports_timed_out(monkeypatch):
    """Simulate a runaway container: the first `communicate()` call raises
    TimeoutExpired (as it would for an infinite-loop script), and the
    executor must kill the named container and return a timed-out result —
    without ever falling back to a host subprocess."""
    import subprocess

    import backend.app.features.coding.execution as ce

    monkeypatch.setattr(ce, "_docker_available", lambda: True)

    class _FakeProc:
        def __init__(self):
            self.calls = 0

        def communicate(self, timeout=None):
            self.calls += 1
            if self.calls == 1:
                raise subprocess.TimeoutExpired(cmd="docker", timeout=timeout)
            return "", ""

    killed = {}

    def fake_popen(argv, **kwargs):
        if argv[:2] == ["docker", "run"]:
            return _FakeProc()
        raise AssertionError(f"unexpected Popen call: {argv}")

    def fake_run(argv, **kwargs):
        if argv[:2] == ["docker", "kill"]:
            killed["name"] = argv[2]
        return subprocess.CompletedProcess(argv, 0)

    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    monkeypatch.setattr(ce.subprocess, "run", fake_run)

    r = ce.CodeExecutor().run("while True: pass", timeout=2)

    assert r.timed_out is True
    assert r.exit_code == -1
    assert r.unavailable is False
    assert killed.get("name", "").startswith("king-exec-")


# ── validate_relative_path: canonical path-validation boundary ──────────────

@pytest.mark.parametrize("bad", [
    "",
    "\\Windows\\win.ini",
    "C:\\Windows\\win.ini",
    "../escape.py",
    "a\\b.py",
])
def test_validate_relative_path_rejects_forbidden_inputs(bad):
    with pytest.raises(HTTPException) as exc_info:
        validate_relative_path(bad, SANDBOX_DIR, {".py"})
    assert exc_info.value.status_code in (400, 403)


def test_validate_relative_path_allows_nested_artifact_under_root():
    result = validate_relative_path("plots/chart.png", SANDBOX_DIR, {".png"})
    canonical_root = SANDBOX_DIR.resolve(strict=False)
    assert result.is_relative_to(canonical_root)
    assert result.suffix == ".png"


def test_validate_relative_path_rejects_disallowed_suffix():
    with pytest.raises(HTTPException) as exc_info:
        validate_relative_path("notes.txt", SANDBOX_DIR, {".py"})
    assert exc_info.value.status_code == 400


def test_validate_relative_path_rejects_symlinked_session_dir(tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    link = SANDBOX_DIR / "sec-symlink-session"
    if link.exists() or link.is_symlink():
        link.unlink()
    try:
        link.symlink_to(outside, target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("symlink creation not permitted in this environment")
    try:
        with pytest.raises(HTTPException) as exc_info:
            validate_relative_path("sec-symlink-session", SANDBOX_DIR, set())
        assert exc_info.value.status_code == 403
    finally:
        link.unlink()


# ── artifact_response: html/svg must download, never inline-preview ─────────

def test_artifact_response_forces_attachment_for_html(tmp_path):
    path = tmp_path / "report.html"
    path.write_text("<script>alert(1)</script>", encoding="utf-8")
    resp = artifact_response(path)
    assert resp.headers["content-disposition"].startswith("attachment")
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert resp.media_type == "text/html"


def test_artifact_response_forces_attachment_for_svg(tmp_path):
    path = tmp_path / "chart.svg"
    path.write_text("<svg></svg>", encoding="utf-8")
    resp = artifact_response(path)
    assert resp.headers["content-disposition"].startswith("attachment")
    assert resp.headers["x-content-type-options"] == "nosniff"


def test_artifact_response_keeps_images_inline():
    from backend.app.features.coding.artifacts import ATTACHMENT_ONLY_EXTS

    path = SANDBOX_DIR / "sec-inline-test.png"
    path.write_bytes(b"\x89PNG\r\n\x1a\n")
    try:
        resp = artifact_response(path)
        assert ".png" not in ATTACHMENT_ONLY_EXTS
        assert "attachment" not in (resp.headers.get("content-disposition") or "")
    finally:
        path.unlink(missing_ok=True)
