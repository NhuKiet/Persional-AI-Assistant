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

    monkeypatch.setattr(ce, "executor_status", lambda **_: ce.ExecutorStatus(True, "ok"))
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

    monkeypatch.setattr(ce, "executor_status", lambda **_: ce.ExecutorStatus(True, "ok"))

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


# ── Coding run: uploaded_files[].name must never pull host files in ─────────
#
# The old copy loop did `SANDBOX_DIR / name -> session_sandbox / name`, so
# each "../" hop moved a host file one directory closer: ["../../.env",
# "../.env", ".env"] landed the repo's .env inside the session sandbox,
# where generated code could print it.

def test_coding_run_does_not_copy_files_named_in_the_request(tmp_path, monkeypatch):
    import backend.app.features.coding.service as coding_service

    root = tmp_path / "sandbox"
    session_dir = root / "s1"
    session_dir.mkdir(parents=True)
    (tmp_path / "secret.env").write_text("OPENAI_API_KEY=sk-test", encoding="utf-8")
    monkeypatch.setattr(coding_service, "SANDBOX_DIR", root, raising=False)
    monkeypatch.setattr(coding_service, "_session_sandbox", lambda _sid: session_dir)

    names = [{"name": "../secret.env"}, {"name": "secret.env"}]
    run = coding_service.CodingAgent(executor=object()).run("hi", [], "s1", names)
    assert next(run)["type"] == "thinking"
    run.close()

    assert not (root / "secret.env").exists()
    assert not (session_dir / "secret.env").exists()


# ── Shared upload filename rule (coding, pdf, hmer) ─────────────────────────
#
# The backend also runs natively on Windows: there `base / "D:x.csv"` jumps
# to drive D, and "a.txt:x.csv" writes an NTFS alternate data stream.

_BAD_UPLOAD_NAMES = [
    "", ".", "..", "../a.csv", "a/b.csv", "a\\b.csv",
    "D:x.csv", "a.txt:x.csv",
    "CON.txt", "nul", "com1.csv", "LPT9.json",
    "x\x00.csv", "x\n.csv",
]


@pytest.mark.parametrize("bad", _BAD_UPLOAD_NAMES)
def test_safe_filename_rejects(bad):
    from backend.app.shared.files import safe_filename

    with pytest.raises(ValueError):
        safe_filename(bad)


@pytest.mark.parametrize(
    "good", ["data.csv", "b\u00e1o c\u00e1o 2024.xlsx", "my-file_1.json", "console.txt"],
)
def test_safe_filename_accepts_plain_names(good):
    from backend.app.shared.files import safe_filename

    assert safe_filename(good) == good


@pytest.mark.parametrize("bad", ["D:evil.csv", "a.txt:evil.csv", "CON.csv"])
def test_coding_upload_rejects_windows_path_tricks(bad):
    r = _client(coding_router.router).post(
        "/api/coding/upload",
        files={"file": (bad, b"a,b\n1,2\n", "text/csv")},
        data={"session_id": "sec-sess"},
    )
    assert r.status_code == 400


@pytest.mark.parametrize("bad", ["D:main.py", "a.txt:x.csv", "CON"])
def test_coding_delete_rejects_windows_path_tricks(bad):
    r = _client(coding_router.router).delete(
        f"/api/coding/file/{bad}", params={"session_id": "sec-sess"},
    )
    assert r.status_code == 400


@pytest.mark.parametrize(
    "method,path",
    [("get", "/api/pdf/raw/D:x.pdf"), ("delete", "/api/pdf/file/D:x.pdf"),
     ("get", "/api/pdf/raw/a.pdf:x.pdf")],
)
def test_pdf_file_routes_reject_drive_and_stream_names(method, path):
    r = getattr(_client(pdf_router.router), method)(path)
    assert r.status_code == 400


def test_coding_upload_refuses_to_write_through_symlink_leaving_sandbox(tmp_path):
    # Generated code can create symlinks in its (writable) session dir; the
    # backend writes there as the host user and must not follow them out.
    from backend.app.features.coding.service import _session_sandbox

    sdir = _session_sandbox("sec-symlink-upload")
    outside = tmp_path / "victim.csv"
    outside.write_text("original", encoding="utf-8")
    link = sdir / "victim.csv"
    try:
        link.symlink_to(outside)
    except (OSError, NotImplementedError):
        pytest.skip("symlink creation not permitted in this environment")
    try:
        r = _client(coding_router.router).post(
            "/api/coding/upload",
            files={"file": ("victim.csv", b"pwned", "text/csv")},
            data={"session_id": "sec-symlink-upload"},
        )
        assert r.status_code == 400
        assert outside.read_text(encoding="utf-8") == "original"
    finally:
        link.unlink()
