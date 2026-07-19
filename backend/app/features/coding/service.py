import asyncio
import ast
import json
import logging
import re
import shutil
import sqlite3
import threading
from collections.abc import AsyncIterator, Callable, Generator, Iterator
from pathlib import Path

from fastapi import HTTPException

from backend.app.core.config import settings
from backend.app.core.llm import invoke_chat, stream_chat
from backend.app.features.coding.artifacts import ARTIFACT_EXTS, ArtifactService, emit_path_rejected, validate_relative_path
from backend.app.features.coding.execution import CodeExecutor, SANDBOX_DIR, detect_missing_packages, install_packages
from backend.app.features.coding.prompts import CHAT_SYSTEM, CODE_PROMPT, DEBUG_PROMPT, PLAN_PROMPT, REVIEW_PROMPT, SYSTEM_PROMPT, TEST_PROMPT
from backend.app.features.coding.schemas import CodingRequest
from backend.app.features.coding.uploads import session_sandbox
from backend.app.shared.session_locks import KeyedLockRegistry, SessionBusyError

__all__ = ["CodingAgent", "CodingConversationManager", "CodingService", "SessionBusyError"]


logger = logging.getLogger(__name__)

MAX_DEBUG_ITER = settings.MAX_DEBUG_ITER
ENABLE_TESTS = settings.ENABLE_TESTS
ENABLE_REVIEW = settings.ENABLE_REVIEW
ENABLE_AUTO_INSTALL = settings.ENABLE_AUTO_INSTALL

# Preserve the legacy tools.coding_agent import surface while keeping the
# implementations canonical in this feature's execution/artifact modules.
_detect_missing_packages = detect_missing_packages
_install_packages = install_packages

_BASE_DIR = Path(__file__).resolve().parents[4]
_DB_PATH = _BASE_DIR / "data" / "sessions.db"


class _CodingSessionStore:
    def __init__(self, db_path: Path = _DB_PATH):
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._db = str(db_path)
        self._lock = threading.Lock()
        with self._lock, self._connect() as connection:
            connection.execute(
                """CREATE TABLE IF NOT EXISTS sessions (
                    key TEXT PRIMARY KEY,
                    messages TEXT NOT NULL DEFAULT '[]',
                    updated_at REAL NOT NULL,
                    revision INTEGER NOT NULL DEFAULT 0
                )"""
            )
            try:
                connection.execute(
                    "ALTER TABLE sessions ADD COLUMN revision INTEGER NOT NULL DEFAULT 0"
                )
            except sqlite3.OperationalError:
                pass  # column already exists (fresh table already has it above)
            connection.commit()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._db, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        return connection

    def load(self, key: str) -> list[dict]:
        return self.load_with_revision(key)[0]

    def load_with_revision(self, key: str) -> tuple[list[dict], int]:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT messages, revision FROM sessions WHERE key = ?", (key,)
            ).fetchone()
            if row is None:
                return [], 0
            try:
                messages = json.loads(row["messages"])
            except json.JSONDecodeError:
                messages = []
            return messages, row["revision"]

    def save(self, key: str, messages: list[dict]) -> None:
        import time

        with self._lock, self._connect() as connection:
            connection.execute(
                """INSERT INTO sessions (key, messages, updated_at, revision) VALUES (?, ?, ?, 1)
                ON CONFLICT(key) DO UPDATE SET
                    messages = excluded.messages,
                    updated_at = excluded.updated_at,
                    revision = sessions.revision + 1""",
                (key, json.dumps(messages, ensure_ascii=False), time.time()),
            )
            connection.commit()

    def delete(self, key: str) -> None:
        with self._lock, self._connect() as connection:
            connection.execute("DELETE FROM sessions WHERE key = ?", (key,))
            connection.commit()


_sessions = _CodingSessionStore()


class CodingConversationManager:
    def __init__(self, namespace: str = "coding"):
        self.namespace = namespace

    def _key(self, session_id: str) -> str:
        return f"{self.namespace}:{session_id}"

    def get_history(self, session_id: str) -> list[dict]:
        return _sessions.load(self._key(session_id))

    def get_history_with_revision(self, session_id: str) -> tuple[list[dict], int]:
        return _sessions.load_with_revision(self._key(session_id))

    def add_turn(self, session_id: str, role: str, content: str) -> None:
        history = self.get_history(session_id)
        history.append({"role": role, "content": content})
        _sessions.save(self._key(session_id), history[-settings.MAX_HISTORY:])

    def clear_session(self, session_id: str) -> None:
        _sessions.delete(self._key(session_id))


def _extract_all_files(text: str) -> list[dict]:
    named = re.findall(r"```python:([\w./\-]+\.py)\s*\n([\s\S]*?)```", text)
    if named:
        return [{"filename": filename.strip(), "code": code.strip()} for filename, code in named]
    match = re.search(r"```python\s*\n([\s\S]*?)```", text)
    if match:
        return [{"filename": "solution.py", "code": match.group(1).strip()}]
    match = re.search(r"```\s*\n([\s\S]*?)```", text)
    if match:
        code = match.group(1).strip()
        if any(keyword in code for keyword in ("import ", "def ", "print(", "plt.", "for ", "class ")):
            return [{"filename": "solution.py", "code": code}]
    stripped = text.strip()
    if stripped.startswith(("import ", "from ", "def ", "class ")):
        return [{"filename": "solution.py", "code": stripped}]
    return []


def _extract_code(text: str) -> str | None:
    files = _extract_all_files(text)
    return files[0]["code"] if files else None


def _split_preamble_safe_prefix(code: str) -> tuple[str, str]:
    """Split ``code`` into ``(prefix, rest)`` where ``prefix`` is the leading
    module docstring (if any) followed by any consecutive
    ``from __future__ import ...`` statements — both of which Python
    requires to precede every other statement in the file — and ``rest`` is
    everything after. Preamble injection must land inside ``rest``, never
    ahead of ``prefix``, or a `from __future__ import` after other code
    raises ``SyntaxError: from __future__ imports must occur at the
    beginning of the file``.

    Falls back to ``("", code)`` when the code doesn't parse — same
    behaviour as before this split existed, since a malformed snippet was
    already going to fail execution and go through the debug loop anyway.
    """
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return "", code

    body = tree.body
    idx = 0
    cut_line = 0

    if (
        body
        and isinstance(body[0], ast.Expr)
        and isinstance(getattr(body[0], "value", None), ast.Constant)
        and isinstance(body[0].value.value, str)
    ):
        cut_line = body[0].end_lineno
        idx = 1

    while idx < len(body) and isinstance(body[idx], ast.ImportFrom) and body[idx].module == "__future__":
        cut_line = body[idx].end_lineno
        idx += 1

    if cut_line == 0:
        return "", code

    lines = code.splitlines(keepends=True)
    return "".join(lines[:cut_line]), "".join(lines[cut_line:])


def _inject_preamble(code: str, sandbox_path: str) -> str:
    prefix, body = _split_preamble_safe_prefix(code)
    uses_mpl = any(keyword in body for keyword in ("matplotlib", "pyplot", "plt.", "seaborn", "sns."))
    chdir_line = f"import os; os.chdir(r'{sandbox_path}')\n"
    if not uses_mpl:
        return prefix + chdir_line + body

    body = re.sub(r'matplotlib\.use\s*\(["\'].*?["\']\)\s*\n?', "", body)
    counter = [0]

    def replace_show(match):
        counter[0] += 1
        filename = "plot.png" if counter[0] == 1 else f"plot_{counter[0]}.png"
        indent = match.group(1)
        return f"{indent}plt.savefig('{filename}', dpi=150, bbox_inches='tight')\n{indent}plt.close()\n{indent}print('Plot saved: {filename}')"

    body = re.sub(r"^(\s*)plt\.show\(\).*$", replace_show, body, flags=re.MULTILINE)
    body = re.sub(r"plt\.show\([^)]*\)", "plt.savefig('plot.png', dpi=150, bbox_inches='tight')", body)
    body = re.sub(r"^import matplotlib\.pyplot as plt\s*\n", "", body, flags=re.MULTILINE)
    body = re.sub(r"^from matplotlib import pyplot as plt\s*\n", "", body, flags=re.MULTILINE)
    body = re.sub(r"^import matplotlib\s*\n", "", body, flags=re.MULTILINE)
    return prefix + chdir_line + "import matplotlib\nmatplotlib.use('Agg')\nimport matplotlib.pyplot as plt\n" + body


def _session_sandbox(session_id: str) -> Path:
    return session_sandbox(session_id)


def _sandbox_snapshot(sandbox: Path) -> set[Path]:
    try:
        return set(sandbox.iterdir())
    except Exception:
        return set()


def _collect_artifacts(snapshot_before: set[Path], sandbox: Path, session_id: str) -> list[str]:
    return ArtifactService.collect(snapshot_before, sandbox, session_id)


def _build_file_context(uploaded_files: list[dict]) -> str:
    if not uploaded_files:
        return ""
    lines = ["Available data files (in working directory):"]
    for file in uploaded_files:
        name, size, preview = file.get("name", ""), file.get("size", 0), file.get("preview", "")
        lines.append(f"  - {name} ({size} bytes)")
        if preview:
            lines.append(f"    Preview: {preview[:200]}")
    return "\n".join(lines) + "\n\n"


def _build_plot_hint(request: str) -> str:
    plot_keywords = ["plot", "chart", "graph", "vẽ", "biểu đồ", "visualize", "histogram", "scatter", "bar", "line", "pie", "heatmap", "show", "display", "figure", "visualization"]
    if any(keyword in request.lower() for keyword in plot_keywords):
        return (
            "IMPORTANT — visualization task:\n"
            "  import matplotlib\n"
            "  matplotlib.use('Agg')\n"
            "  import matplotlib.pyplot as plt\n"
            "  # ... create figure ...\n"
            "  plt.tight_layout()\n"
            "  plt.savefig('plot.png', dpi=150, bbox_inches='tight')\n"
            "  print('Plot saved to plot.png')\n"
            "NEVER use plt.show()\n"
        )
    return ""


def _history_str(history: list[dict]) -> str:
    if not history:
        return "(no prior conversation)"
    return "\n".join(f"{turn.get('role', 'user').upper()}: {turn.get('content', '')[:400]}" for turn in history[-6:])


def _call_ollama(prompt: str, system: str = SYSTEM_PROMPT, provider: str | None = None, model: str | None = None) -> str:
    return invoke_chat(prompt, system=system, provider=provider, model=model)


def _stream_ollama(prompt: str, system: str = SYSTEM_PROMPT, provider: str | None = None, model: str | None = None) -> Iterator[str]:
    yield from stream_chat([{"role": "user", "content": prompt}], system=system, provider=provider, model=model)


_CANCELLED_EVENT = {"type": "cancelled", "message": "Đã hủy theo yêu cầu."}


class CodingAgent:
    def __init__(self, executor: CodeExecutor | None = None):
        self.executor = executor or CodeExecutor()

    @staticmethod
    def _cancelled(cancel_event: "threading.Event | None") -> bool:
        return cancel_event is not None and cancel_event.is_set()

    def chat(self, message: str, history: list[dict], provider: str | None = None, model: str | None = None) -> Iterator[str]:
        prompt = f"Conversation history:\n{_history_str(history)}\n\nUser: {message}"
        yield from _stream_ollama(prompt, system=CHAT_SYSTEM, provider=provider, model=model)

    def run(
        self,
        request: str,
        history: list[dict],
        session_id: str,
        uploaded_files: list[dict] | None = None,
        provider: str | None = None,
        model: str | None = None,
        cancel_event: "threading.Event | None" = None,
    ) -> Generator[dict, None, None]:
        history_str = _history_str(history)
        file_context = _build_file_context(uploaded_files or [])
        plot_hint = _build_plot_hint(request)
        sandbox = _session_sandbox(session_id)
        sandbox_str = str(sandbox).replace("\\", "/")

        for uploaded_file in uploaded_files or []:
            source = SANDBOX_DIR / uploaded_file.get("name", "")
            destination = sandbox / uploaded_file.get("name", "")
            if source.exists() and not destination.exists():
                shutil.copy2(source, destination)

        yield {"type": "thinking", "message": "Đang lên kế hoạch..."}
        plan_tokens: list[str] = []
        try:
            for token in _stream_ollama(PLAN_PROMPT.format(request=request, file_context=file_context, history=history_str), system="You are a senior Python developer. Return only valid JSON arrays.", provider=provider, model=model):
                if self._cancelled(cancel_event):
                    yield _CANCELLED_EVENT
                    return
                plan_tokens.append(token)
                yield {"type": "plan_thinking", "content": token}
            plan = self._parse_plan("".join(plan_tokens))
        except Exception as exc:
            logger.warning("Plan parse failed: %s", exc)
            plan = [
                {"step": 1, "title": "Phân tích yêu cầu", "description": request},
                {"step": 2, "title": "Viết code", "description": "Implement in Python"},
                {"step": 3, "title": "Kiểm tra", "description": "Run and verify"},
            ]
        yield {"type": "plan", "steps": plan}

        if self._cancelled(cancel_event):
            yield _CANCELLED_EVENT
            return

        yield {"type": "generating", "message": "Đang viết code..."}
        plan_text = "\n".join(f"{step['step']}. {step['title']}: {step['description']}" for step in plan)
        raw_tokens: list[str] = []
        try:
            for token in _stream_ollama(CODE_PROMPT.format(request=request, file_context=file_context, plan=plan_text, history=history_str, plot_hint=plot_hint), provider=provider, model=model):
                if self._cancelled(cancel_event):
                    yield _CANCELLED_EVENT
                    return
                raw_tokens.append(token)
                yield {"type": "code_token", "content": token}
        except RuntimeError as exc:
            yield {"type": "error", "message": str(exc)}
            return

        file_blocks = _extract_all_files("".join(raw_tokens))
        if not file_blocks:
            yield {"type": "error", "message": "LLM không tạo ra code block. Thử diễn đạt lại."}
            return

        processed: list[dict] = []
        for index, file_block in enumerate(file_blocks):
            filename = file_block["filename"]
            try:
                target = validate_relative_path(filename, sandbox, {".py"})
            except HTTPException as exc:
                emit_path_rejected(session_id, str(exc.detail))
                continue
            code = _inject_preamble(file_block["code"], sandbox_str)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(code, encoding="utf-8")
            processed.append({"filename": filename, "code": code})
            yield {"type": "code", "language": "python", "filename": filename, "content": code, "is_multifile": len(file_blocks) > 1, "file_index": index, "total_files": len(file_blocks)}

        if not processed:
            yield {"type": "error", "message": "LLM không tạo ra file .py hợp lệ trong sandbox. Thử diễn đạt lại."}
            return

        if len(processed) == 1:
            entry = processed[0]
        else:
            # Multi-file output requires an explicit, declared entry point —
            # silently running file index 0 previously meant "main.py" (the
            # file most likely to be the real entry point, by convention)
            # could go unexecuted while a helper module ran instead.
            entry = next((f for f in processed if f["filename"].lower() == "main.py"), None)
            if entry is None:
                yield {
                    "type": "done",
                    "success": False,
                    "message": "Nhiều file được tạo nhưng không có file main.py làm entry point rõ ràng. Vui lòng mô tả lại yêu cầu và chỉ định file khởi chạy chính (main.py).",
                    "iterations": 0,
                    "final_code": "",
                    "artifacts": [],
                }
                return

        current_code = entry["code"]
        iteration = 0
        auto_installed: list[str] = []
        result = None
        while iteration <= MAX_DEBUG_ITER:
            if self._cancelled(cancel_event):
                yield _CANCELLED_EVENT
                return

            if iteration == 0:
                yield {"type": "executing", "message": "Đang chạy code..."}
            else:
                yield {"type": "debugging", "iteration": iteration, "message": f"Debug lần {iteration}/{MAX_DEBUG_ITER}..."}

            snapshot_before = _sandbox_snapshot(sandbox)
            result = self.executor.run(current_code, sandbox=sandbox, session_id=session_id)
            artifacts = _collect_artifacts(snapshot_before, sandbox, session_id)
            if result.unavailable:
                yield {"type": "done", "success": False, "message": "Trình thực thi code hiện không khả dụng. Vui lòng thử lại sau.", "iterations": iteration, "final_code": current_code, "artifacts": artifacts}
                return
            yield {"type": "output", "stdout": result.stdout, "stderr": result.stderr, "exit_code": result.exit_code, "duration": round(result.duration, 2), "timed_out": result.timed_out, "artifacts": artifacts}
            if result.success:
                break

            if "No module named" in result.stderr and not auto_installed:
                missing = detect_missing_packages(result.stderr)
                if missing and ENABLE_AUTO_INSTALL:
                    yield {"type": "installing", "message": f"Đang cài: {', '.join(missing)}...", "packages": missing}
                    ok, log = install_packages(missing)
                    auto_installed.extend(missing)
                    yield {"type": "install_done", "success": ok, "packages": missing, "log": log}
                    if ok:
                        continue
                elif missing:
                    yield {"type": "done", "success": False, "message": "Thiếu package: " + ", ".join(missing) + ". Auto-install đang tắt vì lý do bảo mật — cài sẵn trong môi trường rồi chạy lại, hoặc bật ENABLE_AUTO_INSTALL nếu executor đã được cách ly.", "iterations": iteration, "final_code": current_code, "artifacts": artifacts}
                    return

            if iteration >= MAX_DEBUG_ITER:
                yield {"type": "done", "success": False, "message": f"Không sửa được sau {MAX_DEBUG_ITER} lần. Mô tả lại yêu cầu.", "iterations": iteration, "final_code": current_code, "artifacts": artifacts}
                return

            iteration += 1
            try:
                fixed_raw = _call_ollama(DEBUG_PROMPT.format(request=request, file_context=file_context, code=current_code, error=(result.stderr or f"Exit {result.exit_code}")[:3000], stdout=result.stdout[:1000], iteration=iteration, max_iter=MAX_DEBUG_ITER), provider=provider, model=model)
            except RuntimeError as exc:
                yield {"type": "error", "message": str(exc)}
                return

            fixed_blocks = _extract_all_files(fixed_raw)
            if not fixed_blocks:
                yield {"type": "done", "success": False, "message": "LLM không tạo ra code sửa lỗi.", "iterations": iteration, "final_code": current_code, "artifacts": []}
                return

            current_code = _inject_preamble(fixed_blocks[0]["code"], sandbox_str)
            filename_fix = f"solution_v{iteration + 1}.py"
            try:
                fix_target = validate_relative_path(filename_fix, sandbox, {".py"})
            except HTTPException as exc:
                emit_path_rejected(session_id, str(exc.detail))
                yield {"type": "done", "success": False, "message": "Không thể ghi file sửa lỗi vào sandbox.", "iterations": iteration, "final_code": current_code, "artifacts": []}
                return
            fix_target.write_text(current_code, encoding="utf-8")
            yield {"type": "code", "language": "python", "filename": filename_fix, "content": current_code, "is_fix": True, "iteration": iteration}

        all_artifacts = _collect_artifacts(set(), sandbox, session_id)
        test_results = None
        if ENABLE_TESTS and result and result.success:
            if self._cancelled(cancel_event):
                yield _CANCELLED_EVENT
                return
            yield {"type": "testing", "message": "Đang sinh test cases..."}
            try:
                test_raw = _call_ollama(TEST_PROMPT.format(code=current_code[:4000], stdout=(result.stdout or "")[:500]), provider=provider, model=model)
                test_code = _extract_code(test_raw)
                if test_code:
                    test_full = f"import os; os.chdir(r'{sandbox_str}')\nimport pytest, sys\n\n" + test_code + "\n\nif __name__ == '__main__':\n    pytest.main([__file__, '-v', '--tb=short'])\n"
                    validate_relative_path("test_solution.py", sandbox, {".py"}).write_text(test_full, encoding="utf-8")
                    yield {"type": "code", "language": "python", "filename": "test_solution.py", "content": test_full, "is_test": True}
                    test_result = self.executor.run(test_full, sandbox=sandbox, session_id=session_id)
                    test_results = {"stdout": test_result.stdout, "stderr": test_result.stderr, "exit_code": test_result.exit_code, "success": test_result.success}
                    yield {"type": "test_output", **test_results}
            except Exception as exc:
                logger.warning("Test gen failed: %s", exc)

        has_review = False
        if ENABLE_REVIEW and result and result.success:
            if self._cancelled(cancel_event):
                yield _CANCELLED_EVENT
                return
            yield {"type": "reviewing", "message": "Đang review code..."}
            try:
                review = _call_ollama(REVIEW_PROMPT.format(code=current_code[:4000], stdout=(result.stdout or "")[:500]), provider=provider, model=model)
                yield {"type": "review", "content": review}
                has_review = True
            except Exception as exc:
                logger.warning("Review failed: %s", exc)

        yield {"type": "done", "success": True, "message": f"Thành công{' sau ' + str(iteration) + ' lần debug' if iteration > 0 else ''}", "iterations": iteration, "final_code": current_code, "artifacts": all_artifacts, "test_results": test_results, "has_review": has_review}

    @staticmethod
    def _parse_plan(raw: str) -> list[dict]:
        text = re.sub(r"```(?:json)?\s*", "", raw).replace("```", "").strip()
        match = re.search(r"\[.*\]", text, re.DOTALL)
        return json.loads(match.group()) if match else json.loads(text)


class CodingService:
    def __init__(self, agent_factory: Callable[..., CodingAgent] | None = None, conversations: CodingConversationManager | None = None):
        self._agent = (agent_factory or CodingAgent)()
        self._conversations = conversations or CodingConversationManager()
        # Single-worker only — see backend/app/shared/session_locks.py.
        self._locks = KeyedLockRegistry()

    def begin_session(self, session_id: str):
        """Reserve exclusive mutation rights for a session for the lifetime of
        one stream. Raises SessionBusyError if another stream already holds it."""
        lock = self._locks.try_acquire(session_id)
        if lock is None:
            raise SessionBusyError(session_id)
        return lock

    def end_session(self, lock) -> None:
        self._locks.release(lock)

    async def stream(self, request: CodingRequest) -> AsyncIterator[dict]:
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[dict] = asyncio.Queue()
        cancel_event = threading.Event()

        def run_agent() -> None:
            try:
                history = self._conversations.get_history(request.session_id)

                def _persist(assistant_content: str) -> None:
                    self._conversations.add_turn(request.session_id, role="user", content=request.message)
                    self._conversations.add_turn(request.session_id, role="assistant", content=assistant_content)

                if request.chat_only:
                    response_parts: list[str] = []
                    for token in self._agent.chat(request.message, history, provider=request.provider, model=request.model):
                        if cancel_event.is_set():
                            loop.call_soon_threadsafe(queue.put_nowait, {"type": "cancelled", "message": "Đã hủy theo yêu cầu."})
                            return
                        response_parts.append(token)
                        loop.call_soon_threadsafe(queue.put_nowait, {"type": "token", "content": token})
                    _persist("".join(response_parts))
                    loop.call_soon_threadsafe(queue.put_nowait, {"type": "done", "success": True, "message": "", "iterations": 0})
                else:
                    assistant_content = "[agent run]"
                    for event in self._agent.run(request.message, history, request.session_id, request.uploaded_files, provider=request.provider, model=request.model, cancel_event=cancel_event):
                        if event.get("type") == "done":
                            assistant_content = event.get("message") or assistant_content
                            _persist(assistant_content)
                        loop.call_soon_threadsafe(queue.put_nowait, event)
            except Exception as exc:
                logger.error("Coding agent error: %s", exc, exc_info=True)
                loop.call_soon_threadsafe(queue.put_nowait, {"type": "error", "message": str(exc)})

        threading.Thread(target=run_agent, daemon=True).start()
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=600)
                    yield event
                    if event.get("type") in ("done", "error", "cancelled"):
                        break
                except asyncio.TimeoutError:
                    yield {"type": "error", "message": "Coding agent timed out (10 min)"}
                    break
        finally:
            # Client disconnect (GeneratorExit via aclose()) or normal
            # completion — either way, tell the background agent thread to
            # stop instead of letting an abandoned run keep burning
            # LLM/executor work after nobody is listening.
            cancel_event.set()
