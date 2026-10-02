"""Session lock lifecycle: a session is busy exactly while work on it can
still change its history — not longer (a stuck 409 until restart) and not
shorter (two writers at once).
"""
import asyncio
import json
import threading
import time

import pytest

from backend.app.shared.session_locks import KeyedLockRegistry


# ── the registry ────────────────────────────────────────────────────────


def test_one_holder_at_a_time_and_release_frees_it():
    locks = KeyedLockRegistry()
    lease = locks.try_acquire("s1")

    assert lease is not None
    assert locks.try_acquire("s1") is None
    lease.release()
    assert locks.try_acquire("s1") is not None


def test_release_is_idempotent():
    locks = KeyedLockRegistry()
    first = locks.try_acquire("s1")
    worker = locks.share("s1")

    first.release()
    first.release()  # a second call must not give up the worker's share

    assert locks.try_acquire("s1") is None
    worker.release()
    assert locks.try_acquire("s1") is not None


def test_a_shared_lease_keeps_the_session_busy_until_every_holder_is_done():
    locks = KeyedLockRegistry()
    request = locks.try_acquire("s1")
    worker = locks.share("s1")

    request.release()  # the HTTP side is gone...
    assert locks.try_acquire("s1") is None  # ...but the worker thread can still write

    worker.release()
    assert locks.try_acquire("s1") is not None


def test_share_of_a_free_session_is_none():
    assert KeyedLockRegistry().share("nobody") is None


def test_the_registry_does_not_grow_with_every_session_ever_seen():
    locks = KeyedLockRegistry()
    for i in range(1000):
        locks.try_acquire(f"s{i}").release()

    assert len(locks) == 0


def test_a_lease_held_past_its_maximum_age_is_taken_over():
    now = {"t": 0.0}
    locks = KeyedLockRegistry(max_age=60, clock=lambda: now["t"])
    stuck = locks.try_acquire("s1")

    now["t"] = 30
    assert locks.try_acquire("s1") is None
    now["t"] = 61
    fresh = locks.try_acquire("s1")
    assert fresh is not None

    stuck.release()  # the stale holder finally lets go: must not free the new one
    assert locks.try_acquire("s1") is None
    fresh.release()


# ── a client that disconnects before the stream starts ──────────────────


def _scope(path: str) -> dict:
    return {
        "type": "http", "asgi": {"version": "3.0", "spec_version": "2.4"}, "http_version": "1.1",
        "method": "POST", "path": path, "raw_path": path.encode(), "query_string": b"", "root_path": "",
        "scheme": "http", "client": ("127.0.0.1", 5000), "server": ("testserver", 80),
        "headers": [(b"host", b"testserver"), (b"content-type", b"application/json"), (b"x-king-client", b"test")],
    }


def test_disconnect_before_the_first_byte_still_frees_the_session(monkeypatch):
    import backend.app.features.chat.router as chat_router
    from main import app

    async def fake_stream(req):
        yield {"type": "token", "content": "never sent"}

    monkeypatch.setattr(chat_router._service, "stream", fake_stream)
    body = json.dumps({"message": "hi", "session_id": "gone-1"}).encode()
    inbox = [{"type": "http.request", "body": body, "more_body": False}]

    async def receive():
        return inbox.pop(0) if inbox else {"type": "http.disconnect"}

    async def send(message):
        if message["type"] == "http.response.start":
            raise OSError("client went away")  # what uvicorn does after a disconnect

    async def call():
        try:
            await app(_scope("/api/chat/stream"), receive, send)
        except Exception:
            pass  # ClientDisconnect — the point is what state it leaves behind

    asyncio.run(call())

    lease = chat_router._service.begin_session("gone-1")  # used to raise SessionBusyError forever
    chat_router._service.end_session(lease)


# ── a worker thread that outlives the request ───────────────────────────


def _wait_until(predicate, timeout=3.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return False


def _free(service, session_id: str) -> bool:
    from backend.app.shared.session_locks import SessionBusyError

    try:
        service.end_session(service.begin_session(session_id))
        return True
    except SessionBusyError:
        return False


def test_pdf_answer_abandoned_mid_stream_holds_the_session_until_its_thread_stops_and_saves_nothing(monkeypatch):
    from backend.app.features.pdf.processor import PDFDocument
    from backend.app.features.pdf.schemas import PDFChatRequest
    from backend.app.features.pdf.service import PdfService
    from backend.app.shared.conversation_store import ConversationManager

    conversations = ConversationManager(namespace="pdf-test")
    svc = PdfService(conversations=conversations)
    doc = PDFDocument(filename="d.pdf", total_pages=1, total_chars=5, full_text="hello")
    monkeypatch.setattr(svc, "_get_doc", lambda filename: doc)
    monkeypatch.setattr(svc._processor, "retrieve", lambda document, message: [])
    monkeypatch.setattr(svc._processor, "select_context_chunks", lambda document, retrieved: [])
    monkeypatch.setattr(svc._processor, "build_context_from_chunks", lambda document, chunks: "ctx")
    gate = threading.Event()

    def slow_llm(messages, system, provider=None, model=None):
        yield "first "
        gate.wait(5)
        yield "second"

    monkeypatch.setattr(svc, "_stream_llm", slow_llm)
    request = PDFChatRequest(message="q", filename="d.pdf", session_id="p1")
    lease = svc.begin_session("p1")

    async def abandon_after_first_token():
        stream = svc.chat_events(request, "SYS")
        async for event in stream:
            if event["type"] == "token":
                break
        await stream.aclose()  # the browser went away

    asyncio.run(abandon_after_first_token())
    svc.end_session(lease)  # the HTTP side lets go

    assert not _free(svc, "p1")  # the thread is still mid-answer
    gate.set()
    assert _wait_until(lambda: _free(svc, "p1"))
    assert conversations.get_history("p1") == []  # an abandoned answer is not saved


def test_coding_run_abandoned_mid_way_holds_the_session_until_its_thread_stops(monkeypatch):
    from backend.app.features.coding.schemas import CodingRequest
    from backend.app.features.coding.service import CodingService

    svc = CodingService()
    gate = threading.Event()

    def slow_run(*args, cancel_event=None, **kwargs):
        yield {"type": "plan", "steps": []}
        gate.wait(5)
        yield {"type": "done", "success": True, "message": "xong"}

    monkeypatch.setattr(svc._agent, "run", slow_run)
    request = CodingRequest(message="viết hàm", session_id="c1")
    lease = svc.begin_session("c1")

    async def abandon_after_plan():
        stream = svc.stream(request)
        async for event in stream:
            if event["type"] == "plan":
                break
        await stream.aclose()

    asyncio.run(abandon_after_plan())
    svc.end_session(lease)

    assert not _free(svc, "c1")
    gate.set()
    assert _wait_until(lambda: _free(svc, "c1"))
