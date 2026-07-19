"""Container-executor logic for the Docker-only sandbox.

Kiem tra: dung argv `docker run` cach ly dung (du toan bo cac global
constraint), viet lai os.chdir cho container, va — khi daemon Docker khong
san sang — tra ve mot ExecutionResult typed voi unavailable=True MA KHONG
bao gio tao/chay host subprocess. Khong test chay that trong container (can
daemon) — phan do co checklist verify tay trong tai lieu.
"""
import logging
from pathlib import Path

import backend.app.features.coding.execution as ce
from backend.app.core.config import settings


def test_rewrite_chdir_targets_container_workdir():
    src = "import os; os.chdir(r'C:/Users/x/data/sandbox/sess')\nprint(1)"
    out = ce._rewrite_chdir_for_container(src)
    assert "os.chdir('/work')" in out
    assert "C:/Users" not in out


def test_docker_run_argv_has_isolation_flags():
    argv = ce._docker_run_argv("run_abc.py", Path("/tmp/sandbox/sess"), "king-exec-abc")
    joined = " ".join(argv)
    assert argv[:3] == ["docker", "run", "--rm"]

    def flag_value(flag: str) -> str:
        return argv[argv.index(flag) + 1]

    assert flag_value("--network") == "none"
    assert flag_value("--memory") == "512m"
    assert flag_value("--cpus") == "1.0"
    assert flag_value("--pids-limit") == "128"
    assert flag_value("--cap-drop") == "ALL"
    assert flag_value("--security-opt") == "no-new-privileges:true"
    assert "--read-only" in argv
    assert flag_value("--tmpfs") == "/tmp:rw,size=64m"
    # mount sandbox -> /work, chay dung script
    assert f"{Path('/tmp/sandbox/sess')}:{ce.CONTAINER_WORKDIR}:rw" in argv
    assert argv[-3:] == [settings.EXECUTOR_IMAGE, "python", f"{ce.CONTAINER_WORKDIR}/run_abc.py"]
    # KHONG duoc lo secret host: khong co -e nao mang API key
    assert "ANTHROPIC_API_KEY" not in joined and "TAVILY_API_KEY" not in joined


def test_docker_unavailable_returns_typed_result_without_subprocess(monkeypatch, tmp_path):
    monkeypatch.setattr(ce, "_docker_available", lambda: False)
    called = {"run_subprocess": False}

    def fake_run_subprocess(*_args, **_kwargs):
        called["run_subprocess"] = True
        raise AssertionError("host subprocess must never be created when Docker is unavailable")

    # `raising=False`: the host-subprocess path has been removed entirely,
    # so this attaches a spy attribute purely to prove nothing calls it.
    monkeypatch.setattr(ce.CodeExecutor, "_run_subprocess", fake_run_subprocess, raising=False)

    r = ce.CodeExecutor().run("print(6*7)", sandbox=tmp_path)

    assert called["run_subprocess"] is False
    assert r.unavailable is True
    assert r.reason_code == "docker_unavailable"
    assert r.exit_code == -1
    assert r.timed_out is False
    assert not list(tmp_path.iterdir())  # no script ever written to disk


def test_docker_unavailable_logs_structured_event(monkeypatch, tmp_path, caplog):
    monkeypatch.setattr(ce, "_docker_available", lambda: False)
    with caplog.at_level(logging.INFO):
        ce.CodeExecutor().run("print(1)", sandbox=tmp_path, session_id="s-1")

    assert "coding.execution_unavailable" in caplog.text
    assert "reason_code=docker_unavailable" in caplog.text
    assert "session_id=s-1" in caplog.text


def test_docker_mode_dispatches_to_docker_with_rewritten_chdir(monkeypatch, tmp_path):
    monkeypatch.setattr(ce, "_docker_available", lambda: True)

    captured = {}

    def fake_run_docker(self, script_path, run_dir, timeout):
        captured["script"] = Path(script_path).read_text(encoding="utf-8")
        return ce.ExecutionResult(stdout="ok", stderr="", exit_code=0,
                                  timed_out=False, duration=0.0)

    monkeypatch.setattr(ce.CodeExecutor, "_run_docker", fake_run_docker)
    code = "import os; os.chdir(r'C:/host/sandbox/s')\nprint('hi')"
    r = ce.CodeExecutor().run(code, sandbox=tmp_path)
    assert r.stdout == "ok"
    # Script that su viet ra da duoc rewrite chdir -> /work.
    assert "os.chdir('/work')" in captured["script"]
    assert "C:/host" not in captured["script"]


def test_docker_dispatch_logs_started_and_finished_events(monkeypatch, tmp_path, caplog):
    monkeypatch.setattr(ce, "_docker_available", lambda: True)

    def fake_run_docker(self, script_path, run_dir, timeout):
        return ce.ExecutionResult(stdout="ok", stderr="", exit_code=0,
                                  timed_out=False, duration=0.01)

    monkeypatch.setattr(ce.CodeExecutor, "_run_docker", fake_run_docker)
    with caplog.at_level(logging.INFO):
        ce.CodeExecutor().run("print(1)", sandbox=tmp_path, session_id="s-2")

    assert "coding.execution_started" in caplog.text
    assert "coding.execution_finished" in caplog.text
    assert "session_id=s-2" in caplog.text


# ── Host-UID override vs. host-permission-widening (chmod) fallback ─────────
#
# Dockerfile.executor's container runs as a fixed non-root UID (10001:10001)
# that won't generally match whatever host account owns the bind-mounted
# sandbox dir. On POSIX hosts the executor overrides `--user` to the *host*
# UID/GID instead of loosening host directory permissions — a world-writable
# sandbox dir was a real host-side isolation regression on shared hosts (see
# the removed `run_dir.chmod(0o777)` unconditional call). Windows has no
# POSIX UID/GID concept, so it keeps the chmod(0o777) fallback.

def test_docker_run_argv_includes_host_user_override_on_posix_host(monkeypatch):
    monkeypatch.setattr(ce.os, "getuid", lambda: 1000, raising=False)
    monkeypatch.setattr(ce.os, "getgid", lambda: 1000, raising=False)

    argv = ce._docker_run_argv("run_abc.py", Path("/tmp/sandbox/sess"), "king-exec-abc")

    idx = argv.index("--user")
    assert argv[idx + 1] == "1000:1000"


def test_docker_run_argv_omits_user_override_without_host_getuid(monkeypatch):
    # Windows (and anything else lacking os.getuid): no host UID to match,
    # so no --user override is added — the image's baked-in USER applies.
    monkeypatch.delattr(ce.os, "getuid", raising=False)

    argv = ce._docker_run_argv("run_abc.py", Path("/tmp/sandbox/sess"), "king-exec-abc")

    assert "--user" not in argv


def test_host_user_docker_args_never_overrides_to_root(monkeypatch):
    # If the backend process itself runs as UID 0 (e.g. a future
    # Docker-socket-mounted deployment), emitting --user 0:0 would make the
    # sandbox container run as root, defeating Dockerfile.executor's
    # non-root hardening. Must fall back to "no override" (image default)
    # instead of ever passing --user 0:*.
    monkeypatch.setattr(ce.os, "getuid", lambda: 0, raising=False)
    monkeypatch.setattr(ce.os, "getgid", lambda: 0, raising=False)

    assert ce._host_user_docker_args() == []

    argv = ce._docker_run_argv("run_abc.py", Path("/tmp/sandbox/sess"), "king-exec-abc")
    assert "--user" not in argv
    assert "0:0" not in argv


def test_run_does_not_widen_sandbox_permissions_when_host_user_override_available(monkeypatch, tmp_path):
    """On a POSIX host (os.getuid present), the container matches the host
    UID via --user, so CodeExecutor.run() must NOT fall back to
    world-writable chmod(0o777) on the sandbox directory."""
    monkeypatch.setattr(ce, "_docker_available", lambda: True)
    monkeypatch.setattr(ce.os, "getuid", lambda: 1000, raising=False)
    monkeypatch.setattr(ce.os, "getgid", lambda: 1000, raising=False)

    chmod_calls = []
    monkeypatch.setattr(Path, "chmod", lambda self, mode: chmod_calls.append(mode))

    def fake_run_docker(self, script_path, run_dir, timeout):
        return ce.ExecutionResult(stdout="ok", stderr="", exit_code=0, timed_out=False, duration=0.0)

    monkeypatch.setattr(ce.CodeExecutor, "_run_docker", fake_run_docker)
    ce.CodeExecutor().run("print(1)", sandbox=tmp_path)

    assert chmod_calls == []


def test_run_still_chmods_sandbox_without_host_getuid(monkeypatch, tmp_path):
    """Without os.getuid (Windows), there is no --user override to make, so
    the chmod(0o777) fallback is still exercised there specifically."""
    monkeypatch.setattr(ce, "_docker_available", lambda: True)
    monkeypatch.delattr(ce.os, "getuid", raising=False)

    chmod_calls = []
    monkeypatch.setattr(Path, "chmod", lambda self, mode: chmod_calls.append(mode))

    def fake_run_docker(self, script_path, run_dir, timeout):
        return ce.ExecutionResult(stdout="ok", stderr="", exit_code=0, timed_out=False, duration=0.0)

    monkeypatch.setattr(ce.CodeExecutor, "_run_docker", fake_run_docker)
    ce.CodeExecutor().run("print(1)", sandbox=tmp_path)

    assert chmod_calls == [0o777]
