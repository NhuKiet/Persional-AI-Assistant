import hashlib
import logging
import os
import re
import signal
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

_SAFE_ENV_KEYS = (
    "PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR",
    "TEMP", "TMP", "COMSPEC", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE",
    "APPDATA", "LOCALAPPDATA", "HOME", "LANG", "LC_ALL", "TZ", "PYTHONHOME", "PYTHONPATH",
)

_STDLIB = {"os", "sys", "re", "json", "math", "time", "datetime", "pathlib", "typing", "collections", "itertools", "functools", "io", "abc", "copy", "random", "string", "hashlib", "base64", "subprocess", "threading", "queue", "logging", "warnings", "traceback"}
_PIP_MAP = {"sklearn": "scikit-learn", "cv2": "opencv-python", "PIL": "Pillow", "yaml": "PyYAML", "bs4": "beautifulsoup4", "dateutil": "python-dateutil", "dotenv": "python-dotenv"}


def _safe_env() -> dict[str, str]:
    env = {key: os.environ[key] for key in _SAFE_ENV_KEYS if key in os.environ}
    for name in (name.strip() for name in settings.CODE_ENV_EXTRA.split(",")):
        if name and name in os.environ:
            env[name] = os.environ[name]
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["PYTHONUNBUFFERED"] = "1"
    return env


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


def _kill_tree(proc: "subprocess.Popen") -> None:
    if proc.poll() is not None:
        return
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True, timeout=10)
        else:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except Exception as exc:
        logger.warning("kill_tree failed: %s", exc)
        try:
            proc.kill()
        except Exception:
            pass


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
            logger.warning("Docker daemon không sẵn sàng — executor dùng subprocess.")
    return _docker_ok


def _rewrite_chdir_for_container(code: str) -> str:
    return re.sub(
        r"os\.chdir\(\s*r?['\"].*?['\"]\s*\)",
        f"os.chdir('{CONTAINER_WORKDIR}')",
        code,
    )


def _docker_run_argv(script_name: str, run_dir: Path, name: str) -> list[str]:
    return [
        "docker", "run", "--rm",
        "--name", name,
        "--network", "none",
        "--memory", settings.EXECUTOR_MEMORY,
        "--cpus", settings.EXECUTOR_CPUS,
        "--pids-limit", str(settings.EXECUTOR_PIDS),
        "--read-only",
        "--tmpfs", "/tmp:rw,size=64m",
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

    @property
    def success(self) -> bool:
        return self.exit_code == 0 and not self.timed_out

    def summary(self) -> str:
        if self.timed_out:
            return f"Timed out after {TIMEOUT_SEC}s"
        if self.success:
            return f"OK in {self.duration:.2f}s"
        return f"Exit {self.exit_code} in {self.duration:.2f}s"


class CodeExecutor:
    def __init__(self):
        SANDBOX_DIR.mkdir(parents=True, exist_ok=True)

    def run(self, code: str, timeout: int = TIMEOUT_SEC, sandbox: Path | None = None) -> ExecutionResult:
        run_dir = (sandbox or SANDBOX_DIR).resolve()
        run_dir.mkdir(parents=True, exist_ok=True)

        use_docker = settings.EXECUTOR_MODE == "docker" and _docker_available()
        if settings.EXECUTOR_MODE == "docker" and not use_docker:
            logger.warning("EXECUTOR_MODE=docker nhưng Docker không sẵn sàng — fallback subprocess.")

        script_code = _rewrite_chdir_for_container(code) if use_docker else code
        code_hash = hashlib.md5(code.encode()).hexdigest()[:8]
        script_path = run_dir / f"run_{code_hash}_{int(time.time())}.py"

        try:
            script_path.write_text(script_code, encoding="utf-8")
            logger.info("Executing %s (mode=%s, dir=%s)", script_path, "docker" if use_docker else "subprocess", run_dir)
            result = self._run_docker(script_path, run_dir, timeout) if use_docker else self._run_subprocess(script_path, run_dir, timeout)
            logger.info("Execution: %s", result.summary())
            return result
        finally:
            try:
                script_path.unlink(missing_ok=True)
            except Exception:
                pass

    def _run_subprocess(self, script_path: Path, run_dir: Path, timeout: int) -> ExecutionResult:
        popen_kw: dict = {}
        if os.name == "nt":
            popen_kw["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            popen_kw["start_new_session"] = True

        start = time.time()
        proc = subprocess.Popen(
            [sys.executable, str(script_path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=str(run_dir),
            env=_safe_env(),
            **popen_kw,
        )
        try:
            stdout, stderr = proc.communicate(timeout=timeout)
            return ExecutionResult(self._truncate(stdout or ""), self._truncate(stderr or ""), proc.returncode, False, time.time() - start)
        except subprocess.TimeoutExpired:
            _kill_tree(proc)
            try:
                proc.communicate(timeout=5)
            except Exception:
                pass
            return ExecutionResult("", f"Process killed after {timeout}s timeout", -1, True, time.time() - start)

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
