import hashlib
import logging
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from backend.app.core.config import settings


logger = logging.getLogger(__name__)

CONTAINER_WORKDIR = "/work"

_BASE_DIR = Path(__file__).resolve().parents[4]
SANDBOX_DIR = (_BASE_DIR / "data" / "sandbox").resolve()

TIMEOUT_SEC = settings.CODE_TIMEOUT
MAX_OUTPUT_LEN = settings.MAX_OUTPUT_LEN

_STDLIB = {"os", "sys", "re", "json", "math", "time", "datetime", "pathlib", "typing", "collections", "itertools", "functools", "io", "abc", "copy", "random", "string", "hashlib", "base64", "subprocess", "threading", "queue", "logging", "warnings", "traceback"}
_PIP_MAP = {"sklearn": "scikit-learn", "cv2": "opencv-python", "PIL": "Pillow", "yaml": "PyYAML", "bs4": "beautifulsoup4", "dateutil": "python-dateutil", "dotenv": "python-dotenv"}

# Canonical sanitizer for session ids in log lines. Lives here (rather than
# in artifacts.py, where it originated) because execution.py is the lower
# module in the coding feature's import graph — artifacts.py already imports
# SANDBOX_DIR from this module, so the reverse import would be circular.
# artifacts.py imports this symbol rather than keeping its own copy.
_SESSION_ID_RE = re.compile(r"[^a-zA-Z0-9_\-]")


def safe_session_id(session_id: str) -> str:
    return _SESSION_ID_RE.sub("_", session_id)[:64]


def _emit_execution_event(event: str, session_id: str | None, reason_code: str) -> None:
    """Structured, PII-free audit log for a coding execution lifecycle event.

    Only the event name, a sanitized session id, and a categorical reason
    code are logged — never raw code, stdout/stderr, or host paths. Distinct
    from artifacts.py's `emit_path_rejected`: that one is a single
    fixed-name, WARNING-level event for path-validation rejections; this one
    covers three different execution-lifecycle event names at INFO level
    (unavailable/started/finished are all routine operational events, not
    security rejections).
    """
    logger.info(
        "%s feature=coding session_id=%s reason_code=%s",
        event,
        safe_session_id(session_id or "(unknown)"),
        reason_code,
    )


def detect_missing_packages(stderr: str) -> list[str]:
    packages = []
    for match in re.finditer(r"No module named ['\"]([^'\"]+)['\"]", stderr):
        top_level = match.group(1).split(".")[0]
        if top_level not in _STDLIB:
            packages.append(top_level)
    return list(dict.fromkeys(packages))


def install_packages(packages: list[str]) -> tuple[bool, str]:
    pip_names = [_PIP_MAP.get(package, package) for package in packages]
    command = [sys.executable, "-m", "pip", "install", "--quiet", *pip_names]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=120)
        return result.returncode == 0, (result.stdout + result.stderr).strip()[:500]
    except Exception as exc:
        return False, str(exc)


_docker_ok: bool | None = None


def _docker_available() -> bool:
    global _docker_ok
    if _docker_ok is None:
        try:
            result = subprocess.run(["docker", "info"], capture_output=True, timeout=8)
            _docker_ok = result.returncode == 0
        except Exception:
            _docker_ok = False
        if not _docker_ok:
            logger.warning("Docker daemon không sẵn sàng — chạy code sinh bị vô hiệu hoá (không fallback host).")
    return _docker_ok


def _rewrite_chdir_for_container(code: str) -> str:
    return re.sub(
        r"os\.chdir\(\s*r?['\"].*?['\"]\s*\)",
        f"os.chdir('{CONTAINER_WORKDIR}')",
        code,
    )


def _host_user_docker_args() -> list[str]:
    """`--user` override so the container's UID/GID matches the host owner
    of the bind-mounted sandbox dir, instead of the image's baked-in
    non-root user (10001:10001 in Dockerfile.executor — still the correct
    default when no override applies, e.g. no bind mount, or run outside
    this function's control).

    Without this override the container UID would never match whatever
    host user owns the sandbox directory, and the previous fix for that
    mismatch (unconditionally `chmod(0o777)`-ing the host sandbox dir) was
    itself a host-side isolation regression: it made a live session's
    sandbox directory world-writable to every local account on a shared
    host for the run's duration.

    POSIX only: `os.getuid`/`os.getgid` don't exist on Windows, and Docker
    Desktop's bind-mount permission model there goes through a WSL2/
    Hyper-V VM rather than a direct host-UID mapping, so there is no
    equivalent override to make on Windows — `CodeExecutor.run()` keeps the
    `chmod(0o777)` fallback for that platform instead (see there for why).

    Never overrides to root: if the host process itself runs as UID 0 (a
    currently-unreachable case today, but the README already flags a
    future Docker-socket-mounted backend deployment), emitting `--user
    0:0` would make the executor container run as root — defeating
    Dockerfile.executor's whole non-root-UID hardening for an untrusted
    code sandbox. Non-root containment matters more here than sandbox-dir
    write convenience, so a root host process gets no override at all and
    falls back to the image's baked-in non-root user, same as the
    no-getuid (Windows) case. This reintroduces the original
    chmod-permission-mismatch problem for that one case (root host +
    non-root container UID = the container can't write the bind mount
    as-is) — accepted tradeoff, not fixed further, since it's not
    reachable in the current deployment.
    """
    if not hasattr(os, "getuid"):
        return []
    uid, gid = os.getuid(), os.getgid()
    if uid == 0:
        return []
    return ["--user", f"{uid}:{gid}"]


def _docker_run_argv(script_name: str, run_dir: Path, name: str) -> list[str]:
    """Build the `docker run` argv enforcing every global isolation constraint.

    512m RAM, 1.0 CPU, 128 PIDs, network off, read-only root with a 64m
    `/tmp` tmpfs, all Linux capabilities dropped, no privilege escalation,
    and (on POSIX hosts) a `--user` override matching the host UID/GID that
    owns the bind-mounted sandbox dir — see backend/app/core/config.py
    EXECUTOR_* settings and `_host_user_docker_args()`.
    """
    return [
        "docker", "run", "--rm",
        "--name", name,
        "--network", "none",
        "--memory", settings.EXECUTOR_MEMORY,
        "--cpus", settings.EXECUTOR_CPUS,
        "--pids-limit", str(settings.EXECUTOR_PIDS),
        "--read-only",
        "--tmpfs", "/tmp:rw,size=64m",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges:true",
        *_host_user_docker_args(),
        "-e", "PYTHONDONTWRITEBYTECODE=1",
        "-e", "PYTHONUNBUFFERED=1",
        "-e", "MPLCONFIGDIR=/tmp",
        "-v", f"{run_dir}:{CONTAINER_WORKDIR}:rw",
        "-w", CONTAINER_WORKDIR,
        settings.EXECUTOR_IMAGE,
        "python", f"{CONTAINER_WORKDIR}/{script_name}",
    ]


@dataclass
class ExecutionResult:
    stdout: str
    stderr: str
    exit_code: int
    timed_out: bool
    duration: float
    # Set when the Docker executor could not run the code at all (daemon
    # unavailable). `exit_code` is -1 and stdout/stderr carry no code
    # output in this case — callers must check `unavailable` before
    # treating exit_code/stdout/stderr as a real run result.
    unavailable: bool = False
    reason_code: str | None = None

    @property
    def success(self) -> bool:
        return not self.unavailable and self.exit_code == 0 and not self.timed_out

    def summary(self) -> str:
        if self.unavailable:
            return f"Unavailable ({self.reason_code})"
        if self.timed_out:
            return f"Timed out after {TIMEOUT_SEC}s"
        if self.success:
            return f"OK in {self.duration:.2f}s"
        return f"Exit {self.exit_code} in {self.duration:.2f}s"


class CodeExecutor:
    """Runs LLM-generated code exclusively inside a hardened Docker container.

    There is no host-subprocess fallback: if the Docker daemon is not
    available, `run()` returns a typed `ExecutionResult(unavailable=True)`
    instead of ever creating a host process for untrusted code.
    """

    def __init__(self):
        SANDBOX_DIR.mkdir(parents=True, exist_ok=True)

    def run(self, code: str, timeout: int = TIMEOUT_SEC, sandbox: Path | None = None, session_id: str | None = None) -> ExecutionResult:
        run_dir = (sandbox or SANDBOX_DIR).resolve()
        run_dir.mkdir(parents=True, exist_ok=True)
        if not hasattr(os, "getuid"):
            # Windows only: there is no host-UID `--user` override to make
            # here (see _host_user_docker_args()), and Docker Desktop's
            # bind-mount permission model on Windows goes through a WSL2/
            # Hyper-V VM rather than a direct UID mapping. Dockerfile.executor
            # runs as a fixed non-root UID/GID (10001:10001) that won't match
            # any host account there, so open the permissions as a best-effort
            # fallback so the container can still write output into the
            # bind-mounted sandbox. On POSIX hosts, `_docker_run_argv` instead
            # passes `--user {uid}:{gid}` matching the host owner of
            # `run_dir`, so no permission-widening is needed or done there.
            try:
                run_dir.chmod(0o777)
            except Exception:
                pass

        if not _docker_available():
            _emit_execution_event("coding.execution_unavailable", session_id, "docker_unavailable")
            return ExecutionResult(
                stdout="",
                stderr="Code execution is currently unavailable.",
                exit_code=-1,
                timed_out=False,
                duration=0.0,
                unavailable=True,
                reason_code="docker_unavailable",
            )

        script_code = _rewrite_chdir_for_container(code)
        code_hash = hashlib.md5(code.encode()).hexdigest()[:8]
        script_path = run_dir / f"run_{code_hash}_{int(time.time())}.py"

        try:
            script_path.write_text(script_code, encoding="utf-8")
            _emit_execution_event("coding.execution_started", session_id, "docker")
            result = self._run_docker(script_path, run_dir, timeout)
            reason_code = "timeout" if result.timed_out else ("ok" if result.success else "nonzero_exit")
            _emit_execution_event("coding.execution_finished", session_id, reason_code)
            return result
        finally:
            try:
                script_path.unlink(missing_ok=True)
            except Exception:
                pass

    def _run_docker(self, script_path: Path, run_dir: Path, timeout: int) -> ExecutionResult:
        name = f"king-exec-{script_path.stem}"
        argv = _docker_run_argv(script_path.name, run_dir, name)
        start = time.time()
        proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            stdout, stderr = proc.communicate(timeout=timeout)
            return ExecutionResult(self._truncate(stdout or ""), self._truncate(stderr or ""), proc.returncode, False, time.time() - start)
        except subprocess.TimeoutExpired:
            try:
                subprocess.run(["docker", "kill", name], capture_output=True, timeout=15)
            except Exception as exc:
                logger.warning("docker kill failed: %s", exc)
            try:
                proc.communicate(timeout=5)
            except Exception:
                pass
            return ExecutionResult("", f"Container killed after {timeout}s timeout", -1, True, time.time() - start)

    def _truncate(self, text: str) -> str:
        if len(text) <= MAX_OUTPUT_LEN:
            return text
        half = MAX_OUTPUT_LEN // 2
        return text[:half] + f"\n\n... [truncated {len(text) - MAX_OUTPUT_LEN} chars] ...\n\n" + text[-half:]
