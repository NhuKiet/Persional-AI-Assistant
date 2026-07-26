import asyncio
import time

import pytest

import backend.app.shared.conversation_store as conv_mod
import backend.app.features.research.service as service_mod
from backend.app.features.research.schemas import DeepDiveRequest, ResearchRequest
from backend.app.shared.conversation_store import ConversationManager
from backend.app.shared.session_locks import SessionBusyError
from tests.fake_session_store import FakeSessionStore


def test_stream_events_yields_done_with_contract_keys(monkeypatch):
    """ResearchService.stream_events phải phát 'done' với đúng 10 khóa data,
    bọc agent.run_streaming (fake) — không chạm mạng/LLM."""
    DONE = {
        "query": "q", "summary_short": "", "summary_medium": "",
        "summary_detailed": "", "key_points": [], "comparison_table": [],
        "chart_data": None, "papers": [], "references": [],
        "follow_up_questions": [],
    }

    class _FakeAgent:
        def run_streaming(self, query, provider=None, model=None, cancel_event=None, history=None):
            yield {"type": "source_done", "source": "web", "count": 1}
            yield {"type": "done", "data": DONE}

    svc = service_mod.ResearchService(agent=_FakeAgent())

    async def _collect():
        return [ev async for ev in svc.stream_events(ResearchRequest(query="q"))]

    events = asyncio.run(_collect())
    done = [e for e in events if e.get("type") == "done"]
    assert len(done) == 1
    assert set(done[0]["data"]) == set(DONE)


def test_stream_events_persists_query_and_result_in_order(monkeypatch, tmp_path):
    monkeypatch.setattr(conv_mod, "_store", FakeSessionStore())
    DONE = {"query": "q", "summary_short": "s"}

    class _FakeAgent:
        def run_streaming(self, query, provider=None, model=None, cancel_event=None, history=None):
            yield {"type": "done", "data": DONE}

    svc = service_mod.ResearchService(agent=_FakeAgent())

    async def _collect():
        return [
            ev async for ev in svc.stream_events(
                ResearchRequest(query="q", session_id="sess-1")
            )
        ]

    asyncio.run(_collect())

    messages, revision = svc.get_history_with_revision("sess-1")
    assert messages == [
        {"role": "user", "content": "q"},
        {"role": "assistant", "content": DONE},
    ]
    assert revision == 2


def test_deep_dive_events_persists_question_and_answer(monkeypatch, tmp_path):
    monkeypatch.setattr(conv_mod, "_store", FakeSessionStore())

    async def fake_astream(messages, system="", provider=None, model=None, temperature=0.1):
        for t in ["hel", "lo"]:
            yield t

    monkeypatch.setattr(service_mod, "astream_chat", fake_astream)
    svc = service_mod.ResearchService(agent=object())

    async def _collect():
        return [
            ev async for ev in svc.deep_dive_events(
                DeepDiveRequest(
                    question="what?", source_content="src", session_id="sess-2"
                ),
                system="SYS",
            )
        ]

    asyncio.run(_collect())

    messages, revision = svc.get_history_with_revision("sess-2")
    assert messages == [
        {"role": "user", "content": "what?"},
        {"role": "assistant", "content": "hello"},
    ]
    assert revision == 2


def test_deep_dive_events_retrieves_full_content_when_snippet_short(monkeypatch, tmp_path):
    """source_content shorter than _DEEP_DIVE_MIN_CONTENT + a url present →
    deep-dive re-crawls the source instead of answering off the short
    reference snippet the client happens to have."""
    monkeypatch.setattr(conv_mod, "_store", FakeSessionStore())
    monkeypatch.setattr(service_mod, "_crawl_url", lambda url, timeout=8: "full article text " * 50)

    captured = {}

    async def fake_astream(messages, system="", provider=None, model=None, temperature=0.1):
        captured["prompt"] = messages[0]["content"]
        yield "ok"

    monkeypatch.setattr(service_mod, "astream_chat", fake_astream)
    svc = service_mod.ResearchService(agent=object())

    async def _collect():
        return [
            ev async for ev in svc.deep_dive_events(
                DeepDiveRequest(
                    question="what?", source_content="short snippet",
                    source_meta={"url": "https://example.com/article", "title": "T", "source": "web"},
                    session_id="sess-3",
                ),
                system="SYS",
            )
        ]

    asyncio.run(_collect())
    assert "full article text" in captured["prompt"]
    assert "short snippet" not in captured["prompt"]


def test_deep_dive_events_skips_recrawl_when_content_already_long(monkeypatch, tmp_path):
    monkeypatch.setattr(conv_mod, "_store", FakeSessionStore())
    calls = []
    monkeypatch.setattr(service_mod, "_crawl_url", lambda url, timeout=8: calls.append(url) or "should not be used")

    async def fake_astream(messages, system="", provider=None, model=None, temperature=0.1):
        yield "ok"

    monkeypatch.setattr(service_mod, "astream_chat", fake_astream)
    svc = service_mod.ResearchService(agent=object())

    async def _collect():
        return [
            ev async for ev in svc.deep_dive_events(
                DeepDiveRequest(
                    question="what?", source_content="already long content " * 50,
                    source_meta={"url": "https://example.com/article"},
                    session_id="sess-4",
                ),
                system="SYS",
            )
        ]

    asyncio.run(_collect())
    assert calls == []


def test_research_service_second_stream_while_active_raises_busy():
    service = service_mod.ResearchService(agent=object())
    lock = service.begin_session("busy-1")
    try:
        with pytest.raises(SessionBusyError):
            service.begin_session("busy-1")
    finally:
        service.end_session(lock)
    service.end_session(service.begin_session("busy-1"))


# ─────────────────────────────────────────────────────────────────────────────
# Query expansion: uses the configured provider, never a hard Ollama dependency
# ─────────────────────────────────────────────────────────────────────────────

def test_expand_query_uses_the_configured_llm_provider(monkeypatch):
    """expand_query must go through core.llm's provider abstraction (whatever
    settings.DEFAULT_PROVIDER resolves to), not a hardcoded Ollama httpx call."""
    import backend.app.core.llm as llm_mod
    from backend.app.features.research.search.query import expand_query

    captured = {}

    def fake_invoke_chat(prompt, system="", provider=None, model=None, temperature=0.1):
        captured["prompt"] = prompt
        captured["temperature"] = temperature
        return '["alternative query one", "alternative query two"]'

    monkeypatch.setattr(llm_mod, "invoke_chat", fake_invoke_chat)

    result = expand_query("transformer attention mechanisms")

    assert result[0] == "transformer attention mechanisms"
    assert "alternative query one" in result
    assert "alternative query two" in result
    assert captured["prompt"]


def test_expand_query_skips_safely_when_provider_unavailable(monkeypatch):
    """No configured provider / API key / reachable Ollama → expand_query must
    degrade to [original_query], never raise and never block the search."""
    import backend.app.core.llm as llm_mod
    from backend.app.features.research.search.query import expand_query

    def boom(*a, **k):
        raise ValueError("ANTHROPIC_API_KEY chưa cấu hình — không dùng được Claude.")

    monkeypatch.setattr(llm_mod, "invoke_chat", boom)

    assert expand_query("transformer attention mechanisms") == ["transformer attention mechanisms"]


# ─────────────────────────────────────────────────────────────────────────────
# Search timeout: partial results must survive, never crash the pipeline
# ─────────────────────────────────────────────────────────────────────────────

def _fake_result(source: str):
    from backend.app.features.research.models import SearchResult
    return [SearchResult(source=source, title=source, url=f"u-{source}", content="c", score=0.5, extra={})]


def test_search_all_survives_a_hung_source_without_raising(monkeypatch):
    """_search_all's as_completed(..., timeout=...) must not propagate
    TimeoutError when one source hangs past the deadline — it should return
    whatever sources completed in time instead of crashing the caller."""
    import backend.app.features.research.agent as agent_mod

    monkeypatch.setattr(agent_mod, "_SEARCH_TIMEOUT_SECONDS", 0.05)
    agent = agent_mod.ResearchAgent()

    def slow_search(query, k):
        time.sleep(0.3)
        return _fake_result("web")

    monkeypatch.setattr(agent.web, "search", slow_search)
    for attr in ("arxiv", "hf", "github", "openalex", "semantic", "wiki"):
        monkeypatch.setattr(getattr(agent, attr), "search",
                             lambda q, k, n=attr: _fake_result(n))

    # unique query string — the module-level TTL cache is process-global and
    # would otherwise short-circuit this test if another test already
    # cached results for the literal string "q".
    results = agent._search_all("__timeout_survival_test_query__")   # must not raise

    sources = {r.source for r in results}
    assert "web" not in sources           # the hung source never made it back in time
    assert sources                        # but the fast ones did


def test_run_streaming_degrades_gracefully_on_search_timeout(monkeypatch):
    """run_streaming must not crash into an 'error' event when a source
    search hangs past the timeout — it should keep going with whatever
    completed and still reach 'done'."""
    import backend.app.features.research.agent as ra
    from backend.app.features.research.models import ResearchOutput

    monkeypatch.setattr(ra, "_SEARCH_TIMEOUT_SECONDS", 0.05)

    agent = ra.ResearchAgent.__new__(ra.ResearchAgent)

    class _Synth:
        def synthesize_grounded(self, q, sources):
            return ResearchOutput(query=q)

    agent.synth = _Synth()
    agent._pool = None

    monkeypatch.setattr(ra, "get_store", lambda: type("K", (), {
        "retrieve": lambda self, q: [], "add_results": lambda self, q, s: 0,
    })())
    monkeypatch.setattr(ra, "expand_query", lambda q, **_kw: [q])
    monkeypatch.setattr(ra, "get_dynamic_k", lambda q: {})
    monkeypatch.setattr(ra, "_enrich_web_results", lambda r: r)
    monkeypatch.setattr(ra, "deduplicate_results", lambda r, threshold=0.92: r)
    monkeypatch.setattr(ra, "rerank_results", lambda q, r, top_k=15: r)

    def slow_search(q, k):
        time.sleep(0.3)
        return _fake_result("web")

    web = type("S", (), {"search": staticmethod(slow_search)})()
    fast = lambda n: type("S", (), {"search": staticmethod(lambda q, k, n=n: _fake_result(n))})()
    agent.web, agent.arxiv, agent.hf = web, fast("arxiv"), fast("hf")
    agent.github, agent.openalex = fast("github"), fast("openalex")
    agent.semantic, agent.wiki = fast("semantic"), fast("wiki")

    events = list(agent.run_streaming("q"))

    assert not any(e.get("type") == "error" for e in events)
    assert any(e.get("type") == "done" for e in events)


def test_run_streaming_emits_a_dedicated_synthesizing_event(monkeypatch):
    """The phase transition into synthesis must be its own event type, not
    inferred by the frontend from a 'status' event whose source happens to
    be 'llm' (that heuristic also fires for the query-expansion status)."""
    import backend.app.features.research.agent as ra
    from backend.app.features.research.models import ResearchOutput

    agent = ra.ResearchAgent.__new__(ra.ResearchAgent)

    class _Synth:
        def synthesize_grounded(self, q, sources):
            return ResearchOutput(query=q)

    agent.synth = _Synth()
    agent._search_all = lambda q, *a, **k: []
    agent._process_pipeline = lambda q, raw, **k: raw

    monkeypatch.setattr(ra, "get_store", lambda: type("K", (), {
        "retrieve": lambda self, q: [], "add_results": lambda self, q, s: 0,
    })())
    monkeypatch.setattr(ra, "expand_query", lambda q, **_kw: [q])
    monkeypatch.setattr(ra, "get_dynamic_k", lambda q: {})
    monkeypatch.setattr(ra, "_enrich_web_results", lambda r: r)
    monkeypatch.setattr(ra, "deduplicate_results", lambda r, threshold=0.92: r)
    monkeypatch.setattr(ra, "rerank_results", lambda q, r, top_k=15: r)
    for attr in ("web", "arxiv", "wiki", "semantic", "hf", "github", "openalex"):
        setattr(agent, attr, type("S", (), {"search": lambda self, q, k=4: []})())

    events = list(agent.run_streaming("q"))

    synthesizing = [e for e in events if e.get("type") == "synthesizing"]
    assert len(synthesizing) == 1
    # the query-expansion status event (source "llm") must NOT itself be typed "synthesizing"
    assert all(e.get("type") != "synthesizing" or e is synthesizing[0] for e in events)
    llm_status_events = [e for e in events if e.get("type") == "status" and e.get("source") == "llm"]
    assert llm_status_events   # "Expanding query…" status still fires…
    assert all(e.get("type") == "status" for e in llm_status_events)  # …but stays type "status"


def test_run_streaming_threads_the_selected_provider_into_query_expansion(monkeypatch):
    """run_streaming's per-request provider/model (what the user picked in
    the UI's ModelPicker) must reach expand_query — not just whatever
    settings.DEFAULT_PROVIDER happens to be globally configured to."""
    import backend.app.core.llm as llm_mod
    import backend.app.features.research.agent as ra
    from backend.app.features.research.models import ResearchOutput

    monkeypatch.setattr(llm_mod, "get_llm", lambda provider=None, model=None, temperature=0.1: object())

    agent = ra.ResearchAgent.__new__(ra.ResearchAgent)

    class _Synth:
        def __init__(self, *a, **k):
            pass

        def synthesize_grounded(self, q, sources):
            return ResearchOutput(query=q)

    agent.synth = _Synth()
    agent._search_all = lambda q, *a, **k: []
    agent._process_pipeline = lambda q, raw, **k: raw

    captured = {}

    def fake_expand_query(q, provider=None, model=None):
        captured["provider"] = provider
        captured["model"] = model
        return [q]

    monkeypatch.setattr(ra, "get_store", lambda: type("K", (), {
        "retrieve": lambda self, q: [], "add_results": lambda self, q, s: 0,
    })())
    # run_streaming builds its own Synthesizer(get_llm(provider, model)) when
    # provider/model are given — avoid a real ChatAnthropic construction
    # (which needs a configured API key) by faking the class itself.
    monkeypatch.setattr(ra, "Synthesizer", _Synth)
    monkeypatch.setattr(ra, "expand_query", fake_expand_query)
    monkeypatch.setattr(ra, "get_dynamic_k", lambda q: {})
    monkeypatch.setattr(ra, "_enrich_web_results", lambda r: r)
    monkeypatch.setattr(ra, "deduplicate_results", lambda r, threshold=0.92: r)
    monkeypatch.setattr(ra, "rerank_results", lambda q, r, top_k=15: r)
    for attr in ("web", "arxiv", "wiki", "semantic", "hf", "github", "openalex"):
        setattr(agent, attr, type("S", (), {"search": lambda self, q, k=4: []})())

    list(agent.run_streaming("q", provider="anthropic", model="claude-sonnet-5"))

    assert captured == {"provider": "anthropic", "model": "claude-sonnet-5"}


def test_stream_events_yields_storage_error_when_history_load_fails(monkeypatch):
    class _BrokenStore:
        def load(self, key):
            raise RuntimeError("connection refused: db.internal.example.com:5432")
        def load_with_revision(self, key):
            return [], 0
        def save(self, key, messages):
            pass
        def delete(self, key):
            pass
        def cleanup_old(self, max_age_days=30):
            return 0

    monkeypatch.setattr(conv_mod, "_store", _BrokenStore())
    svc = service_mod.ResearchService(agent=object())

    async def _collect():
        return [ev async for ev in svc.stream_events(ResearchRequest(query="q", session_id="s1"))]

    events = asyncio.run(_collect())

    assert events == [{
        "type": "error", "code": "storage_unavailable",
        "message": "Không thể kết nối kho lịch sử.",
    }]
    # the raw exception text (which could contain a hostname) must never reach the client
    assert "db.internal.example.com" not in str(events)


def test_stream_events_yields_storage_error_after_done_when_persist_fails(monkeypatch):
    DONE = {"query": "q", "summary_short": "s"}

    class _FakeAgent:
        def run_streaming(self, query, provider=None, model=None, cancel_event=None, history=None):
            yield {"type": "done", "data": DONE}

    class _SaveFailsStore:
        def load(self, key):
            return []
        def load_with_revision(self, key):
            return [], 0
        def save(self, key, messages):
            raise RuntimeError("connection refused: db.internal.example.com:5432")
        def delete(self, key):
            pass
        def cleanup_old(self, max_age_days=30):
            return 0

    monkeypatch.setattr(conv_mod, "_store", _SaveFailsStore())
    svc = service_mod.ResearchService(agent=_FakeAgent())

    async def _collect():
        return [ev async for ev in svc.stream_events(ResearchRequest(query="q", session_id="s1"))]

    events = asyncio.run(_collect())

    assert events[0]["type"] == "done"
    assert events[0]["data"] == DONE
    assert events[1] == {
        "type": "error", "code": "storage_unavailable",
        "message": "Không thể kết nối kho lịch sử.",
    }
    assert "db.internal.example.com" not in str(events)


def test_deep_dive_events_yields_storage_error_when_history_load_fails(monkeypatch):
    class _BrokenStore:
        def load(self, key):
            raise RuntimeError("connection refused: db.internal.example.com:5432")
        def load_with_revision(self, key):
            return [], 0
        def save(self, key, messages):
            pass
        def delete(self, key):
            pass
        def cleanup_old(self, max_age_days=30):
            return 0

    monkeypatch.setattr(conv_mod, "_store", _BrokenStore())
    svc = service_mod.ResearchService(agent=object())

    async def _collect():
        return [
            ev async for ev in svc.deep_dive_events(
                DeepDiveRequest(
                    question="what?", source_content="src", session_id="s1"
                ),
                system="SYS",
            )
        ]

    events = asyncio.run(_collect())

    assert events == [{
        "type": "error", "code": "storage_unavailable",
        "message": "Không thể kết nối kho lịch sử.",
    }]
    # the raw exception text (which could contain a hostname) must never reach the client
    assert "db.internal.example.com" not in str(events)


def test_deep_dive_events_yields_storage_error_after_done_when_persist_fails(monkeypatch):
    async def fake_astream(messages, system="", provider=None, model=None, temperature=0.1):
        yield "ok"

    monkeypatch.setattr(service_mod, "astream_chat", fake_astream)

    class _SaveFailsStore:
        def load(self, key):
            return []
        def load_with_revision(self, key):
            return [], 0
        def save(self, key, messages):
            raise RuntimeError("connection refused: db.internal.example.com:5432")
        def delete(self, key):
            pass
        def cleanup_old(self, max_age_days=30):
            return 0

    monkeypatch.setattr(conv_mod, "_store", _SaveFailsStore())
    svc = service_mod.ResearchService(agent=object())

    async def _collect():
        return [
            ev async for ev in svc.deep_dive_events(
                DeepDiveRequest(
                    question="what?", source_content="src", session_id="s1"
                ),
                system="SYS",
            )
        ]

    events = asyncio.run(_collect())

    assert events[0]["type"] == "token"
    assert events[1] == {"type": "done", "message": "ok"}
    assert events[2] == {
        "type": "error", "code": "storage_unavailable",
        "message": "Không thể kết nối kho lịch sử.",
    }
    assert "db.internal.example.com" not in str(events)


def test_stream_events_succeeds_normally_when_storage_works(monkeypatch):
    """Regression guard: the try/except added around storage calls must not
    change behavior on the success path."""
    DONE = {"query": "q", "summary_short": "s"}

    class _FakeAgent:
        def run_streaming(self, query, provider=None, model=None, cancel_event=None, history=None):
            yield {"type": "done", "data": DONE}

    from tests.fake_session_store import FakeSessionStore
    monkeypatch.setattr(conv_mod, "_store", FakeSessionStore())
    svc = service_mod.ResearchService(agent=_FakeAgent())

    async def _collect():
        return [ev async for ev in svc.stream_events(ResearchRequest(query="q", session_id="s1"))]

    events = asyncio.run(_collect())

    assert len(events) == 1
    assert events[0]["type"] == "done"
    messages, _ = svc.get_history_with_revision("s1")
    assert [m["role"] for m in messages] == ["user", "assistant"]
