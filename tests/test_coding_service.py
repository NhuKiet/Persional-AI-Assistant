import asyncio
import logging
import threading

import pytest

from backend.app.features.coding.artifacts import ARTIFACT_EXTS
from backend.app.features.coding.execution import ExecutionResult, detect_missing_packages, install_packages
from backend.app.features.coding.prompts import REVIEW_PROMPT, SYSTEM_PROMPT
from backend.app.features.coding.schemas import CodingRequest
import backend.app.features.coding.service as coding_service
from backend.app.features.coding.service import (
    CodingAgent,
    CodingConversationManager,
    CodingService,
    SessionBusyError,
    _build_plot_hint,
    _inject_preamble,
)


def test_coding_request_keeps_existing_public_fields():
    request = CodingRequest(
        message="make a chart",
        session_id="s1",
        chat_only=True,
        uploaded_files=[{"name": "data.csv"}],
        provider="openai",
        model="gpt-4o",
    )

    assert request.session_id == "s1"
    assert request.chat_only is True
    assert request.uploaded_files == [{"name": "data.csv"}]
    assert request.provider == "openai"
    assert request.model == "gpt-4o"


def test_coding_service_uses_injected_agent_factory():
    factory_calls = []

    def factory(**kwargs):
        factory_calls.append(kwargs)
        return object()

    service = CodingService(agent_factory=factory)

    assert service is not None
    assert factory_calls == [{}]


def test_coding_prompts_and_plot_hint_keep_original_literals():
    assert "NEVER call plt.show() — headless environment" in SYSTEM_PROMPT
    assert "safety — max 3 points" in REVIEW_PROMPT
    assert _build_plot_hint("vẽ biểu đồ") == (
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


def test_coding_agent_keeps_user_visible_vietnamese_events(monkeypatch, tmp_path):
    calls = 0

    def fake_stream(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        yield "[]" if calls == 1 else "not a code block"

    monkeypatch.setattr(coding_service, "_stream_ollama", fake_stream)
    agent = CodingAgent()
    monkeypatch.setattr(coding_service, "_session_sandbox", lambda _session_id: tmp_path)

    events = list(agent.run("viết biểu đồ", [], "s1"))

    assert events[0] == {"type": "thinking", "message": "Đang lên kế hoạch..."}
    assert events[3] == {"type": "generating", "message": "Đang viết code..."}
    assert events[-1] == {
        "type": "error",
        "message": "LLM không tạo ra code block. Thử diễn đạt lại.",
    }


def test_agent_rejects_generated_filename_that_escapes_sandbox(monkeypatch, tmp_path, caplog):
    """A malicious/broken LLM response naming a file like `../evil.py` must
    never be written outside the session sandbox. The write is skipped and
    the run reports failure instead of silently escaping the sandbox."""
    calls = 0

    def fake_stream(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            yield "[]"
        else:
            yield "```python:../evil.py\nprint('pwned')\n```"

    monkeypatch.setattr(coding_service, "_stream_ollama", fake_stream)
    monkeypatch.setattr(coding_service, "_session_sandbox", lambda _session_id: tmp_path)

    agent = CodingAgent()
    with caplog.at_level(logging.WARNING):
        events = list(agent.run("viết code", [], "s-escape"))

    escaped = tmp_path.parent / "evil.py"
    assert not escaped.exists()
    assert not (tmp_path / "evil.py").exists()
    assert events[-1]["type"] == "error"

    assert "coding.path_rejected" in caplog.text
    assert "evil.py" not in caplog.text
    assert "../" not in caplog.text


def test_agent_writes_only_py_suffixed_generated_files(monkeypatch, tmp_path):
    """Generated-code writes must be routed through the same suffix
    allowlist as artifacts: only `.py` is ever written to the sandbox."""
    calls = 0

    def fake_stream(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            yield "[]"
        else:
            yield "```python:solution.py\nprint('ok')\n```"

    monkeypatch.setattr(coding_service, "_stream_ollama", fake_stream)
    monkeypatch.setattr(coding_service, "_session_sandbox", lambda _session_id: tmp_path)

    class _FakeResult:
        stdout = "ok\n"
        stderr = ""
        exit_code = 0
        timed_out = False
        duration = 0.01
        success = True
        unavailable = False

    agent = CodingAgent()
    monkeypatch.setattr(agent.executor, "run", lambda code, sandbox=None, session_id=None: _FakeResult())

    events = list(agent.run("viết code", [], "s-ok"))

    assert (tmp_path / "solution.py").exists()
    assert any(e.get("type") == "done" and e.get("success") for e in events)


def test_agent_reports_safe_message_when_executor_unavailable(monkeypatch, tmp_path):
    """When the Docker executor is unavailable, the agent must surface a
    single safe `done` event instead of looping through debug iterations
    against an executor that will never succeed."""
    calls = 0

    def fake_stream(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        yield "[]" if calls == 1 else "```python\nprint('hi')\n```"

    run_calls = []

    def fake_run(code, sandbox=None, session_id=None, timeout=None):
        run_calls.append(session_id)
        return ExecutionResult(
            stdout="", stderr="Code execution is currently unavailable.",
            exit_code=-1, timed_out=False, duration=0.0,
            unavailable=True, reason_code="docker_unavailable",
        )

    monkeypatch.setattr(coding_service, "_stream_ollama", fake_stream)
    monkeypatch.setattr(coding_service, "_session_sandbox", lambda _session_id: tmp_path)
    agent = CodingAgent()
    monkeypatch.setattr(agent.executor, "run", fake_run)

    events = list(agent.run("viết code", [], "s-unavailable"))

    assert run_calls == ["s-unavailable"]  # executor invoked exactly once, no retry loop
    done_events = [e for e in events if e.get("type") == "done"]
    assert len(done_events) == 1
    assert done_events[0]["success"] is False
    assert "không khả dụng" in done_events[0]["message"]


def test_coding_history_serialization_and_revision(monkeypatch, tmp_path):
    monkeypatch.setattr(coding_service, "_sessions", coding_service._CodingSessionStore(tmp_path / "s.db"))
    mgr = CodingConversationManager()

    mgr.add_turn("sess-1", role="user", content="one")
    mgr.add_turn("sess-1", role="assistant", content="two")

    messages, revision = mgr.get_history_with_revision("sess-1")
    assert messages == [
        {"role": "user", "content": "one"},
        {"role": "assistant", "content": "two"},
    ]
    assert revision == 2


def test_coding_clear_session_removes_exact_history(monkeypatch, tmp_path):
    monkeypatch.setattr(coding_service, "_sessions", coding_service._CodingSessionStore(tmp_path / "s.db"))
    mgr = CodingConversationManager()
    mgr.add_turn("sess-2", role="user", content="hi")

    mgr.clear_session("sess-2")

    messages, revision = mgr.get_history_with_revision("sess-2")
    assert messages == []
    assert revision == 0


def test_coding_service_second_stream_while_active_raises_busy():
    service = CodingService(agent_factory=lambda **_k: object())
    lock = service.begin_session("busy-1")
    try:
        with pytest.raises(SessionBusyError):
            service.begin_session("busy-1")
    finally:
        service.end_session(lock)
    service.end_session(service.begin_session("busy-1"))


def test_agent_requires_declared_entry_file_for_multifile_execution(monkeypatch, tmp_path):
    """When the LLM emits multiple named files with no `main.py` entry point,
    the agent must not silently execute file index 0 — it should stop and
    report that an entry file needs to be declared, without ever invoking
    the executor."""
    calls = 0

    def fake_stream(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            yield "[]"
        else:
            yield "```python:utils.py\ndef helper():\n    return 1\n```\n```python:helpers.py\ndef other():\n    return 2\n```"

    monkeypatch.setattr(coding_service, "_stream_ollama", fake_stream)
    monkeypatch.setattr(coding_service, "_session_sandbox", lambda _session_id: tmp_path)

    agent = CodingAgent()
    executor_calls = []
    monkeypatch.setattr(agent.executor, "run", lambda *a, **k: executor_calls.append(1))

    events = list(agent.run("viết nhiều file", [], "s-multi"))

    assert executor_calls == []
    done_events = [e for e in events if e.get("type") == "done"]
    assert len(done_events) == 1
    assert done_events[0]["success"] is False
    assert "main.py" in done_events[0]["message"]


def test_agent_runs_declared_main_entry_for_multifile_execution(monkeypatch, tmp_path):
    """When one of the generated files is named `main.py`, that file (not
    index 0) is the one actually executed."""
    calls = 0

    def fake_stream(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            yield "[]"
        else:
            yield "```python:utils.py\ndef helper():\n    return 1\n```\n```python:main.py\nfrom utils import helper\nprint(helper())\n```"

    monkeypatch.setattr(coding_service, "_stream_ollama", fake_stream)
    monkeypatch.setattr(coding_service, "_session_sandbox", lambda _session_id: tmp_path)

    class _FakeResult:
        stdout = "1\n"
        stderr = ""
        exit_code = 0
        timed_out = False
        duration = 0.01
        success = True
        unavailable = False

    agent = CodingAgent()
    executed_code = []

    def fake_run(code, sandbox=None, session_id=None):
        executed_code.append(code)
        return _FakeResult()

    monkeypatch.setattr(agent.executor, "run", fake_run)

    events = list(agent.run("viết nhiều file", [], "s-main"))

    assert any(e.get("type") == "done" and e.get("success") for e in events)
    assert executed_code, "executor should have run the declared entry file"
    assert "helper()" in executed_code[0] and "def helper" not in executed_code[0]


def test_inject_preamble_preserves_module_docstring_and_future_imports():
    """`from __future__ import ...` must stay the first statement (after an
    optional module docstring) — Python raises a SyntaxError otherwise.
    Preamble injection must land after both, not before."""
    code = (
        '"""Module docstring."""\n'
        "from __future__ import annotations\n"
        "import pandas as pd\n"
        "print(pd.__version__)\n"
    )

    result = _inject_preamble(code, "/sandbox/path")

    assert result.startswith('"""Module docstring."""\nfrom __future__ import annotations\n')
    future_idx = result.index("from __future__")
    chdir_idx = result.index("import os; os.chdir")
    assert future_idx < chdir_idx


def test_inject_preamble_with_matplotlib_preserves_docstring_and_future_imports():
    code = (
        '"""Plotting module."""\n'
        "from __future__ import annotations\n"
        "import matplotlib.pyplot as plt\n"
        "plt.plot([1, 2, 3])\n"
        "plt.show()\n"
    )

    result = _inject_preamble(code, "/sandbox/path")

    assert result.startswith('"""Plotting module."""\nfrom __future__ import annotations\n')
    future_idx = result.index("from __future__")
    mpl_idx = result.index("matplotlib.use")
    assert future_idx < mpl_idx


def test_agent_stops_generation_when_cancelled(monkeypatch, tmp_path):
    """A blocking generator (many code tokens) must stop as soon as
    cancellation is observed, instead of running to completion."""
    calls = 0
    cancel_event = threading.Event()

    def fake_stream(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            yield "[]"
        else:
            for i in range(1000):
                if i == 3:
                    cancel_event.set()
                yield f"tok{i}"

    monkeypatch.setattr(coding_service, "_stream_ollama", fake_stream)
    monkeypatch.setattr(coding_service, "_session_sandbox", lambda _session_id: tmp_path)

    agent = CodingAgent()
    events = list(agent.run("task dài", [], "s-cancel", cancel_event=cancel_event))

    assert events[-1]["type"] == "cancelled"
    code_token_events = [e for e in events if e.get("type") == "code_token"]
    assert len(code_token_events) < 1000


def test_chat_only_mode_stores_real_assistant_response(monkeypatch, tmp_path):
    """Regression: chat_only turns used to always persist the placeholder
    '[agent run]' instead of the real streamed answer."""
    monkeypatch.setattr(coding_service, "_sessions", coding_service._CodingSessionStore(tmp_path / "s.db"))
    mgr = CodingConversationManager()

    class _FakeAgent:
        def chat(self, message, history, provider=None, model=None):
            yield "hel"
            yield "lo"

    service = CodingService(agent_factory=lambda **_k: _FakeAgent(), conversations=mgr)

    async def _collect():
        return [
            e async for e in service.stream(
                CodingRequest(message="hi", session_id="s1", chat_only=True)
            )
        ]

    events = asyncio.run(_collect())
    assert any(e.get("type") == "done" for e in events)

    messages, _ = mgr.get_history_with_revision("s1")
    assert messages[-1] == {"role": "assistant", "content": "hello"}
