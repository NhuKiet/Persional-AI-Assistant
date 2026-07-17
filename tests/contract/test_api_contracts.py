import json

from fastapi.testclient import TestClient

import api_chat
import backend.app.features.chat.router as chat_router
import backend.app.features.coding.router as coding_router
import backend.app.features.pdf.router as pdf_router
import backend.app.features.research.router as research_router
import api_research
from backend.app.main import app as backend_app
from main import app
from backend.app.features.coding.execution import ExecutionResult
from backend.app.features.research.models import ResearchOutput, SearchResult
import backend.app.features.coding.service as coding_agent
import backend.app.features.research.agent as research_agent
import backend.app.features.research.service as research_service


PUBLIC_ROUTES = {
    ("GET", "/openapi.json"),
    ("HEAD", "/openapi.json"),
    ("GET", "/docs"),
    ("HEAD", "/docs"),
    ("GET", "/docs/oauth2-redirect"),
    ("HEAD", "/docs/oauth2-redirect"),
    ("GET", "/redoc"),
    ("HEAD", "/redoc"),
    ("GET", "/health"),
    ("GET", "/api/models"),
    ("POST", "/api/chat/stream"),
    ("DELETE", "/api/chat/session/{session_id}"),
    ("POST", "/api/research/stream"),
    ("POST", "/api/research/deep-dive"),
    ("GET", "/api/paper/{filename}"),
    ("DELETE", "/api/research/cache"),
    ("POST", "/api/coding/upload"),
    ("DELETE", "/api/coding/file/{filename}"),
    ("POST", "/api/coding/stream"),
    ("GET", "/api/coding/artifact/{session_id}/{filename}"),
    ("GET", "/api/coding/artifact/{filename}"),
    ("DELETE", "/api/coding/session/{session_id}"),
    ("GET", "/api/coding/session/{session_id}"),
    ("POST", "/api/pdf/upload"),
    ("GET", "/api/pdf/list"),
    ("GET", "/api/pdf/raw/{filename}"),
    ("DELETE", "/api/pdf/file/{filename}"),
    ("POST", "/api/pdf/stream"),
    ("POST", "/api/pdf/summarize"),
}


def test_root_asgi_adapter_exports_backend_application():
    assert app is backend_app


def test_research_adapter_exports_feature_router_and_routes_remain_registered():
    assert api_research.router is research_router.router

    research_routes = {
        (method, route.path)
        for route in app.routes
        for method in getattr(route, "methods", set())
        if route.path.startswith("/api/research/") or route.path.startswith("/api/paper/")
    }

    assert research_routes == {
        ("POST", "/api/research/stream"),
        ("POST", "/api/research/deep-dive"),
        ("GET", "/api/paper/{filename}"),
        ("DELETE", "/api/research/cache"),
    }


def test_public_routes_keep_methods_and_paths():
    routes = {
        (method, route.path)
        for route in app.routes
        for method in getattr(route, "methods", set())
    }

    assert routes == PUBLIC_ROUTES


def test_health_contract_is_stable():
    response = TestClient(app).get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert "version" in response.json()


def _sse_events(response):
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    return [
        json.loads(line.removeprefix("data: "))
        for line in response.text.splitlines()
        if line.startswith("data: ")
    ]


def test_chat_stream_serializes_token_and_error_events(monkeypatch):
    async def token_stream(**_kwargs):
        yield "contract token"

    monkeypatch.setattr(chat_router._conv_manager, "chat_stream", token_stream)
    token_events = _sse_events(TestClient(app).post(
        "/api/chat/stream", json={"message": "hello"}
    ))

    assert token_events == [{"type": "token", "content": "contract token"}]

    async def failing_stream(**_kwargs):
        if False:
            yield "unreachable"
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(chat_router._conv_manager, "chat_stream", failing_stream)
    error_events = _sse_events(TestClient(app).post(
        "/api/chat/stream", json={"message": "hello"}
    ))

    assert error_events[0]["type"] == "error"
    assert error_events[0]["message"] == "provider unavailable"


def test_research_stream_serializes_research_event_shapes(monkeypatch):
    class FakeAgent:
        def run_streaming(self, *_args, **_kwargs):
            yield {"type": "status", "message": "Searching", "source": "web"}
            yield {"type": "source_done", "source": "web", "count": 2}
            yield {"type": "synthesizing", "message": "Writing", "source": "llm"}
            yield {"type": "done", "data": {
                "query": "contract query", "summary_short": "short",
                "summary_medium": "medium", "summary_detailed": "detailed",
                "key_points": [], "comparison_table": None, "chart_data": None,
                "papers": [], "references": [], "follow_up_questions": [],
            }}

    monkeypatch.setattr(
        research_router, "_service", research_service.ResearchService(agent=FakeAgent())
    )
    events = _sse_events(TestClient(app).post(
        "/api/research/stream", json={"query": "contract query"}
    ))

    assert events[0] == {"type": "status", "message": "Searching", "source": "web"}
    assert events[1]["type"] == "source_done"
    assert events[1]["source"] == "web"
    assert events[1]["count"] == 2
    assert events[2] == {"type": "synthesizing", "message": "Writing", "source": "llm"}
    assert events[3]["type"] == "done"
    assert events[3]["data"]["query"] == "contract query"
    assert {
        "summary_short", "summary_medium", "summary_detailed", "key_points",
        "comparison_table", "chart_data", "papers", "references", "follow_up_questions",
    } <= events[3]["data"].keys()


def test_research_stream_serializes_error_events(monkeypatch):
    class FailingAgent:
        def run_streaming(self, *_args, **_kwargs):
            raise RuntimeError("search unavailable")

    monkeypatch.setattr(
        research_router, "_service", research_service.ResearchService(agent=FailingAgent())
    )
    events = _sse_events(TestClient(app).post(
        "/api/research/stream", json={"query": "contract query"}
    ))

    assert events == [{"type": "error", "message": "search unavailable"}]


def test_research_deep_dive_serializes_token_then_done(monkeypatch):
    async def fake_astream_chat(*_args, **_kwargs):
        yield "grounded answer"

    monkeypatch.setattr(research_service, "astream_chat", fake_astream_chat)
    events = _sse_events(TestClient(app).post("/api/research/deep-dive", json={
        "question": "What does the source say?", "source_content": "Evidence",
    }))

    assert events == [
        {"type": "token", "content": "grounded answer"},
        {"type": "done", "message": "ok"},
    ]


def test_research_deep_dive_serializes_error_events(monkeypatch):
    async def failing_astream_chat(*_args, **_kwargs):
        if False:
            yield "unreachable"
        raise RuntimeError("source unavailable")

    monkeypatch.setattr(research_service, "astream_chat", failing_astream_chat)
    events = _sse_events(TestClient(app).post("/api/research/deep-dive", json={
        "question": "What does the source say?", "source_content": "Evidence",
    }))

    assert events == [{"type": "error", "message": "source unavailable"}]


def test_research_stream_serializes_cached_source_done_event(monkeypatch):
    class CachedKnowledge:
        def retrieve(self, _query):
            return [SearchResult("knowledge", "Cached source", "https://example.com", "Evidence")]

    class Synthesizer:
        def synthesize_rag(self, query, _sources):
            return ResearchOutput(query=query)

    agent = object.__new__(research_agent.ResearchAgent)
    agent.synth = Synthesizer()
    monkeypatch.setattr(research_agent, "get_store", lambda: CachedKnowledge())
    monkeypatch.setattr(
        research_router, "_service", research_service.ResearchService(agent=agent)
    )

    events = _sse_events(TestClient(app).post(
        "/api/research/stream", json={"query": "cached query"}
    ))

    assert events[0] == {
        "type": "source_done", "source": "knowledge", "count": 1, "cached": True,
    }


def test_coding_stream_serializes_agent_event_shapes(monkeypatch):
    def fake_run(*_args, **_kwargs):
        yield {"type": "thinking", "message": "Planning"}
        yield {"type": "plan_thinking", "content": "draft plan"}
        yield {"type": "plan", "steps": [{"step": 1, "title": "Build", "description": "Create it"}]}
        yield {"type": "generating", "message": "Writing code"}
        yield {"type": "code_token", "content": "print"}
        yield {
            "type": "code", "language": "python", "filename": "solution.py",
            "content": "print('ok')", "is_multifile": False, "file_index": 0,
            "total_files": 1,
        }
        yield {"type": "executing", "message": "Running code"}
        yield {"type": "debugging", "iteration": 1, "message": "Fixing code"}
        yield {
            "type": "output", "stdout": "ok\n", "stderr": "", "exit_code": 0,
            "duration": 0.1, "timed_out": False, "artifacts": [],
        }
        yield {"type": "installing", "message": "Installing", "packages": ["pandas"]}
        yield {"type": "install_done", "success": True, "packages": ["pandas"], "log": "ok"}
        yield {"type": "testing", "message": "Testing"}
        yield {"type": "test_output", "stdout": "1 passed", "stderr": "", "exit_code": 0, "success": True}
        yield {"type": "reviewing", "message": "Reviewing"}
        yield {"type": "review", "content": "Looks good"}
        yield {
            "type": "done", "success": True, "message": "Complete",
            "iterations": 0, "final_code": "print('ok')", "artifacts": [],
            "test_results": None, "has_review": True,
        }

    monkeypatch.setattr(coding_router._service._agent, "run", fake_run)
    monkeypatch.setattr(coding_router._conv_manager, "get_history", lambda *_args: [])
    monkeypatch.setattr(coding_router._conv_manager, "add_turn", lambda *_args, **_kwargs: None)
    events = _sse_events(TestClient(app).post(
        "/api/coding/stream", json={"message": "make a script", "session_id": "contract"}
    ))

    assert events[0] == {"type": "thinking", "message": "Planning"}
    assert events[1] == {"type": "plan_thinking", "content": "draft plan"}
    assert events[2]["type"] == "plan"
    assert events[2]["steps"][0] == {"step": 1, "title": "Build", "description": "Create it"}
    assert events[3] == {"type": "generating", "message": "Writing code"}
    assert events[4] == {"type": "code_token", "content": "print"}
    assert events[5]["type"] == "code"
    assert {"language", "filename", "content", "is_multifile", "file_index", "total_files"} <= events[5].keys()
    assert events[6] == {"type": "executing", "message": "Running code"}
    assert events[7] == {"type": "debugging", "iteration": 1, "message": "Fixing code"}
    assert events[8]["type"] == "output"
    assert {"stdout", "stderr", "exit_code", "duration", "timed_out", "artifacts"} <= events[8].keys()
    assert events[9] == {"type": "installing", "message": "Installing", "packages": ["pandas"]}
    assert events[10] == {"type": "install_done", "success": True, "packages": ["pandas"], "log": "ok"}
    assert events[11] == {"type": "testing", "message": "Testing"}
    assert events[12] == {"type": "test_output", "stdout": "1 passed", "stderr": "", "exit_code": 0, "success": True}
    assert events[13] == {"type": "reviewing", "message": "Reviewing"}
    assert events[14] == {"type": "review", "content": "Looks good"}
    assert events[15]["type"] == "done"
    assert events[15]["success"] is True
    assert {"message", "iterations", "final_code", "artifacts", "test_results", "has_review"} <= events[15].keys()


def test_coding_stream_chat_only_serializes_token_and_minimal_done(monkeypatch):
    monkeypatch.setattr(coding_router._service._agent, "chat", lambda *_args, **_kwargs: iter(["chat token"]))
    monkeypatch.setattr(coding_router._conv_manager, "get_history", lambda *_args: [])
    monkeypatch.setattr(coding_router._conv_manager, "add_turn", lambda *_args, **_kwargs: None)

    events = _sse_events(TestClient(app).post("/api/coding/stream", json={
        "message": "explain this", "session_id": "contract", "chat_only": True,
    }))

    assert events == [
        {"type": "token", "content": "chat token"},
        {"type": "done", "success": True, "message": "", "iterations": 0},
    ]


def test_coding_stream_serializes_corrective_code_event(monkeypatch, tmp_path):
    def fake_stream_ollama(_prompt, system=None, **_kwargs):
        if system and "Return only valid JSON arrays" in system:
            yield '[{"step": 1, "title": "Build", "description": "Create code"}]'
        else:
            yield "```python\nraise ValueError('broken')\n```"

    results = iter([
        ExecutionResult("", "ValueError: broken", 1, False, 0.1),
        ExecutionResult("fixed\n", "", 0, False, 0.1),
    ])
    monkeypatch.setattr(coding_agent, "_stream_ollama", fake_stream_ollama)
    monkeypatch.setattr(coding_agent, "_call_ollama", lambda *_args, **_kwargs: "```python\nprint('fixed')\n```")
    monkeypatch.setattr(coding_agent, "_session_sandbox", lambda _session_id: tmp_path)
    monkeypatch.setattr(coding_router._service._agent.executor, "run", lambda *_args, **_kwargs: next(results))
    monkeypatch.setattr(coding_agent, "ENABLE_TESTS", False)
    monkeypatch.setattr(coding_agent, "ENABLE_REVIEW", False)
    monkeypatch.setattr(coding_router._conv_manager, "get_history", lambda *_args: [])
    monkeypatch.setattr(coding_router._conv_manager, "add_turn", lambda *_args, **_kwargs: None)

    events = _sse_events(TestClient(app).post("/api/coding/stream", json={
        "message": "make it work", "session_id": "corrective-contract",
    }))

    corrective_code = next(event for event in events if event.get("is_fix"))
    assert corrective_code["type"] == "code"
    assert corrective_code["iteration"] == 1
    assert corrective_code["is_fix"] is True
    assert corrective_code["language"] == "python"
    assert corrective_code["filename"] == "solution_v2.py"
    sandbox_path = str(tmp_path).replace("\\", "/")
    assert corrective_code["content"] == (
        f"import os; os.chdir(r'{sandbox_path}')\nprint('fixed')"
    )


def test_coding_stream_serializes_agent_error_events(monkeypatch):
    def failing_run(*_args, **_kwargs):
        raise RuntimeError("agent unavailable")

    monkeypatch.setattr(coding_router._service._agent, "run", failing_run)
    monkeypatch.setattr(coding_router._conv_manager, "get_history", lambda *_args: [])
    events = _sse_events(TestClient(app).post(
        "/api/coding/stream", json={"message": "make a script"}
    ))

    assert events == [{"type": "error", "message": "agent unavailable"}]


def test_pdf_stream_and_summary_serialize_token_then_done(monkeypatch):
    monkeypatch.setattr(pdf_router._service, "_get_doc", lambda _filename: object())
    monkeypatch.setattr(pdf_router._service._processor, "build_context", lambda *_args: "context")
    monkeypatch.setattr(pdf_router._service._processor, "summary_context", lambda _doc: "summary")
    monkeypatch.setattr(pdf_router._service, "_stream_llm", lambda *_args, **_kwargs: iter(["pdf token"]))
    monkeypatch.setattr(pdf_router._service._conv_manager, "get_history", lambda *_args: [])
    monkeypatch.setattr(pdf_router._service._conv_manager, "add_turn", lambda *_args, **_kwargs: None)
    client = TestClient(app)

    stream_events = _sse_events(client.post("/api/pdf/stream", json={
        "message": "Explain it", "filename": "contract.pdf",
    }))
    summary_events = _sse_events(client.post("/api/pdf/summarize", json={
        "filename": "contract.pdf",
    }))

    assert stream_events == [
        {"type": "token", "content": "pdf token"},
        {"type": "done", "message": "ok"},
    ]
    assert summary_events == [
        {"type": "token", "content": "pdf token"},
        {"type": "done", "message": "ok"},
    ]


def test_pdf_stream_serializes_error_events(monkeypatch):
    def missing_document(_filename):
        raise FileNotFoundError

    monkeypatch.setattr(pdf_router._service, "_get_doc", missing_document)
    events = _sse_events(TestClient(app).post("/api/pdf/stream", json={
        "message": "Explain it", "filename": "contract.pdf",
    }))

    assert events[0]["type"] == "error"
    assert "contract.pdf" in events[0]["message"]


def test_pdf_summarize_serializes_error_events(monkeypatch):
    def failing_document_lookup(_filename):
        raise RuntimeError("PDF index unavailable")

    monkeypatch.setattr(pdf_router._service, "_get_doc", failing_document_lookup)
    events = _sse_events(TestClient(app).post("/api/pdf/summarize", json={
        "filename": "contract.pdf",
    }))

    assert events == [{"type": "error", "message": "PDF index unavailable"}]
