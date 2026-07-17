"""Container-executor logic that runs WITHOUT a Docker daemon.

Kiem tra: dung argv `docker run` cach ly dung, viet lai os.chdir cho container,
chon mode + fallback ve subprocess khi daemon khong san sang, va dispatch sang
docker khi co. Khong test chay that trong container (can daemon) — phan do co
checklist verify tay trong tai lieu.
"""
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
    assert "--network" in argv and argv[argv.index("--network") + 1] == "none"
    assert "--memory" in argv and "--cpus" in argv and "--pids-limit" in argv
    assert "--read-only" in argv
    # mount sandbox -> /work, chay dung script
    assert f"{Path('/tmp/sandbox/sess')}:{ce.CONTAINER_WORKDIR}:rw" in argv
    assert argv[-3:] == [settings.EXECUTOR_IMAGE, "python", f"{ce.CONTAINER_WORKDIR}/run_abc.py"]
    # KHONG duoc lo secret host: khong co -e nao mang API key
    assert "ANTHROPIC_API_KEY" not in joined and "TAVILY_API_KEY" not in joined


def test_docker_mode_falls_back_when_daemon_absent(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "EXECUTOR_MODE", "docker", raising=False)
    monkeypatch.setattr(ce, "_docker_available", lambda: False)
    # Fallback subprocess van chay duoc code binh thuong.
    r = ce.CodeExecutor().run("print(6*7)", sandbox=tmp_path)
    assert r.success and "42" in r.stdout


def test_docker_mode_dispatches_to_docker_with_rewritten_chdir(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "EXECUTOR_MODE", "docker", raising=False)
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
