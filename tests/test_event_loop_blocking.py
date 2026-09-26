"""History-store (Postgres) calls must never run on the event loop.

With the DB down, psycopg waits up to 3 s to open its pool and 5 s per
connection attempt. A store call made directly on the loop freezes the whole
process for that long: every other SSE stream, /health, everything. Here the
store sleeps like a slow DB, and a /health request started while another
request is inside the store must be answered long before the store returns.
"""
import asyncio
import threading
import time

import httpx
import pytest
from fastapi.testclient import TestClient

import backend.app.features.research.router as research_router
import backend.app.features.research.service as research_service
import backend.app.shared.conversation_store as conv_mod
from backend.app.core.csrf import CLIENT_HEADER
from backend.app.shared.conversation_store import ConversationManager
from main import app
from tests.fake_session_store import FakeSessionStore

DELAY = 0.8


class _Gate:
    """Stands in for a slow blocking call (DB, HTTP, PDF parse): records when
    the first call starts, then sleeps DELAY on whatever thread called it."""

    def __init__(self):
        self.entered = threading.Event()
        self.entered_at = 0.0

    def pass_slowly(self):
        if not self.entered.is_set():
            self.entered_at = time.perf_counter()
            self.entered.set()
        time.sleep(DELAY)


class _SlowStore(FakeSessionStore):
    def __init__(self):
        super().__init__()
        self.gate = _Gate()

    def load_with_revision(self, key):
        self.gate.pass_slowly()
        return super().load_with_revision(key)

    def save(self, key, messages):
        self.gate.pass_slowly()
        super().save(key, messages)

    def delete(self, key):
        self.gate.pass_slowly()
        super().delete(key)


async def _health_wait_while_busy(gate, method, path, **kwargs):
    """Seconds from the moment a request enters the slow call until /health,
    sent right then, completes. ~0 when the call runs off the loop; >= DELAY
    when it blocks it (the loop can't even notice the call started)."""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://testserver", headers={CLIENT_HEADER: "test"},
    ) as client:
        slow = asyncio.create_task(client.request(method, path, **kwargs))
        while not gate.entered.is_set():
            if slow.done():
                slow.result()
                pytest.fail(f"{method} {path} finished without reaching the slow call")
            await asyncio.sleep(0.005)
        assert (await client.get("/health")).status_code == 200
        waited = time.perf_counter() - gate.entered_at
        await slow
    return waited


@pytest.fixture
def slow_store(monkeypatch):
    store = _SlowStore()
    monkeypatch.setattr(conv_mod, "_store", store)
    return store


@pytest.mark.parametrize("method,path", [
    ("DELETE", "/api/chat/session/s1"),
    ("GET", "/api/chat/sessions/s1"),
    ("DELETE", "/api/coding/session/s1"),
    ("GET", "/api/coding/sessions/s1"),
    ("GET", "/api/pdf/sessions/s1"),
    ("DELETE", "/api/pdf/file/not-there.pdf?session_id=s1"),
    ("GET", "/api/research/sessions/s1"),
])
def test_session_endpoints_keep_the_loop_free(slow_store, method, path):
    waited = asyncio.run(_health_wait_while_busy(slow_store.gate, method, path))
    assert waited < DELAY / 2


def test_chat_stream_keeps_the_loop_free(slow_store, monkeypatch):
    async def fake_astream(*_args, **_kwargs):
        yield "ok"

    monkeypatch.setattr(conv_mod, "astream_chat", fake_astream)
    waited = asyncio.run(_health_wait_while_busy(
        slow_store.gate, "POST", "/api/chat/stream", json={"message": "hi", "session_id": "s1"},
    ))
    assert waited < DELAY / 2


def test_research_stream_keeps_the_loop_free(slow_store, monkeypatch):
    class FakeAgent:
        def run_streaming(self, *_args, **_kwargs):
            yield {"type": "done", "data": {"query": "q", "summary_short": "s"}}

    monkeypatch.setattr(
        research_router, "_service", research_service.ResearchService(agent=FakeAgent()),
    )
    waited = asyncio.run(_health_wait_while_busy(
        slow_store.gate, "POST", "/api/research/stream", json={"query": "q", "session_id": "s1"},
    ))
    assert waited < DELAY / 2


def test_research_deep_dive_keeps_the_loop_free(slow_store, monkeypatch):
    async def fake_astream(*_args, **_kwargs):
        yield "ok"

    monkeypatch.setattr(research_service, "astream_chat", fake_astream)
    monkeypatch.setattr(
        research_router, "_service", research_service.ResearchService(agent=object()),
    )
    waited = asyncio.run(_health_wait_while_busy(
        slow_store.gate, "POST", "/api/research/deep-dive",
        json={"question": "q", "source_content": "x" * 600, "session_id": "s1"},
    ))
    assert waited < DELAY / 2


# ── add_turns: one read + one write per exchange ────────────────────────────

class _CountingStore(FakeSessionStore):
    def __init__(self):
        super().__init__()
        self.loads = 0
        self.saves = 0

    def load_with_revision(self, key):
        self.loads += 1
        return super().load_with_revision(key)

    def save(self, key, messages):
        self.saves += 1
        super().save(key, messages)


def test_add_turns_saves_the_exchange_in_one_read_and_one_write(monkeypatch):
    store = _CountingStore()
    monkeypatch.setattr(conv_mod, "_store", store)
    mgr = ConversationManager()

    mgr.add_turns("s1", [("user", "q"), ("assistant", {"summary_short": "a"})])

    assert (store.loads, store.saves) == (1, 1)
    assert mgr.get_history("s1") == [
        {"role": "user", "content": "q"},
        {"role": "assistant", "content": {"summary_short": "a"}},
    ]


def test_add_turns_keeps_only_the_last_max_history(monkeypatch):
    monkeypatch.setattr(conv_mod, "_store", FakeSessionStore())
    monkeypatch.setattr(conv_mod, "MAX_HISTORY", 3)
    mgr = ConversationManager()
    mgr.add_turns("s1", [("user", "1"), ("assistant", "2")])

    mgr.add_turns("s1", [("user", "3"), ("assistant", "4")])

    assert [m["content"] for m in mgr.get_history("s1")] == ["2", "3", "4"]


# ── Other blocking work in request handlers ─────────────────────────────────

@pytest.fixture
def fresh_trending_cache(monkeypatch):
    cache = {"titles": [], "next_fetch": 0.0}
    monkeypatch.setattr(research_router, "_trending_cache", cache)
    return cache


def test_trending_fetch_keeps_the_loop_free(fresh_trending_cache, monkeypatch):
    # fetch_trending_papers is a synchronous httpx call to HuggingFace (8 s
    # timeout); the suggestions box on /research calls this on page load.
    gate = _Gate()

    def slow_fetch(k=6):
        gate.pass_slowly()
        return ["Paper A"]

    monkeypatch.setattr(research_router, "fetch_trending_papers", slow_fetch)
    waited = asyncio.run(_health_wait_while_busy(gate, "GET", "/api/research/trending"))
    assert waited < DELAY / 2


def test_trending_failure_is_not_retried_on_every_page_load(fresh_trending_cache, monkeypatch):
    calls = []

    def failing_fetch(k=6):
        calls.append(k)
        return []  # fetch_trending_papers returns [] on any HF error

    monkeypatch.setattr(research_router, "fetch_trending_papers", failing_fetch)
    client = TestClient(app)
    for _ in range(3):
        assert client.get("/api/research/trending").json() == {"suggestions": []}

    assert len(calls) == 1


def test_trending_success_is_cached(fresh_trending_cache, monkeypatch):
    calls = []

    def fetch(k=6):
        calls.append(k)
        return ["Paper A", "Paper B"]

    monkeypatch.setattr(research_router, "fetch_trending_papers", fetch)
    client = TestClient(app)
    for _ in range(3):
        assert client.get("/api/research/trending").json() == {"suggestions": ["Paper A", "Paper B"]}

    assert len(calls) == 1


def test_pdf_upload_parses_off_the_loop(monkeypatch, tmp_path):
    # PyMuPDF extraction of a file up to 50 MB runs inside the upload request.
    import backend.app.features.pdf.router as pdf_router
    from backend.app.features.pdf.repository import PdfRepository

    gate = _Gate()

    class _Doc:
        total_pages, total_chars, chunks = 1, 10, []

    def slow_extract(filename):
        gate.pass_slowly()
        return _Doc()

    monkeypatch.setattr(pdf_router, "_repository", PdfRepository(tmp_path))
    monkeypatch.setattr(pdf_router._service._processor, "extract", slow_extract)
    monkeypatch.setattr(pdf_router._service, "_doc_cache", {})

    waited = asyncio.run(_health_wait_while_busy(
        gate, "POST", "/api/pdf/upload",
        files={"file": ("doc.pdf", b"%PDF-1.4 fake", "application/pdf")},
    ))
    assert waited < DELAY / 2


def test_coding_upload_parses_its_table_off_the_loop(monkeypatch, tmp_path):
    # The table preview reads a data file of up to MAX_UPLOAD_MB.
    import backend.app.features.coding.uploads as uploads

    gate = _Gate()

    def slow_preview(suffix, content):
        gate.pass_slowly()
        return None

    monkeypatch.setattr(uploads, "SANDBOX_DIR", tmp_path)
    monkeypatch.setattr(uploads, "table_preview", slow_preview)

    waited = asyncio.run(_health_wait_while_busy(
        gate, "POST", "/api/coding/upload",
        files={"file": ("data.csv", b"a,b\n1,2\n", "text/csv")},
        data={"session_id": "s1"},
    ))
    assert waited < DELAY / 2
