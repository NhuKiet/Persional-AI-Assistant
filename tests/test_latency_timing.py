"""Per-stage timing of every streamed answer: time to first token, time to
each research source and to synthesis, total — logged per run, summarised
as p50/p95 at /health/latency so "what is slow" has an answer.
"""
import asyncio
import logging

import pytest
from fastapi.testclient import TestClient

from backend.app.core.csrf import CLIENT_HEADER
from backend.app.shared.latency import LatencyStats, timed


class _Clock:
    """A clock the fake event stream moves by hand."""

    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now


async def _events(clock: _Clock, steps: list[tuple[float, dict]]):
    for delay, event in steps:
        clock.now += delay
        yield event


def _drain(stream):
    async def run():
        return [e async for e in stream]
    return asyncio.run(run())


def test_records_time_to_first_token_and_total():
    stats, clock = LatencyStats(), _Clock()
    steps = [
        (0.2, {"type": "status", "message": "…"}),
        (0.6, {"type": "token", "content": "Xin"}),
        (0.5, {"type": "token", "content": " chào"}),
        (0.1, {"type": "done", "message": "ok"}),
    ]

    events = _drain(timed("chat", _events(clock, steps), stats=stats, clock=clock))

    assert [e["type"] for e in events] == ["status", "token", "token", "done"]  # passes through untouched
    snap = stats.snapshot()["chat"]
    assert snap["first_token"]["last_ms"] == 800
    assert snap["total"]["last_ms"] == 1400


def test_research_marks_each_source_and_the_start_of_synthesis():
    stats, clock = LatencyStats(), _Clock()
    steps = [
        (1.0, {"type": "source_done", "source": "arxiv"}),
        (2.0, {"type": "source_done", "source": "web"}),
        (0.5, {"type": "synthesizing"}),
        (2.0, {"type": "section_done", "section": "short"}),
        (1.0, {"type": "token", "content": "A"}),
        (1.0, {"type": "done", "data": {}}),
    ]

    _drain(timed("research", _events(clock, steps), stats=stats, clock=clock))

    snap = stats.snapshot()["research"]
    assert snap["source:arxiv"]["last_ms"] == 1000
    assert snap["source:web"]["last_ms"] == 3000
    assert snap["synthesizing"]["last_ms"] == 3500
    # Research answers arrive as sections: the first one is when the user sees something.
    assert snap["first_section"]["last_ms"] == 5500
    assert snap["first_token"]["last_ms"] == 6500
    assert snap["total"]["last_ms"] == 7500


def test_a_stream_that_just_ends_counts_as_finished():
    # Chat sends tokens and closes — no "done" event. Found measuring for real.
    stats, clock = LatencyStats(), _Clock()
    steps = [(1.0, {"type": "token", "content": "a"}), (2.0, {"type": "token", "content": "b"})]

    _drain(timed("chat", _events(clock, steps), stats=stats, clock=clock))

    assert stats.snapshot()["chat"]["total"]["last_ms"] == 3000


def test_a_failed_run_keeps_its_stages_but_not_a_total():
    stats, clock = LatencyStats(), _Clock()
    steps = [(0.3, {"type": "token", "content": "x"}), (0.2, {"type": "error", "message": "boom"})]

    _drain(timed("pdf", _events(clock, steps), stats=stats, clock=clock))

    snap = stats.snapshot()["pdf"]
    assert "total" not in snap  # an error's duration would skew the p95 of real answers
    assert snap["first_token"]["last_ms"] == 300


def test_percentiles_over_a_bounded_window():
    stats = LatencyStats(window=100)
    for ms in range(1, 301):  # only the last 100 (201…300) count
        stats.record("chat", "total", ms)

    total = stats.snapshot()["chat"]["total"]
    assert total["count"] == 100
    assert total["p50_ms"] == 250
    assert total["p95_ms"] == 295
    assert total["last_ms"] == 300


def test_each_run_is_logged_on_one_line(caplog):
    stats, clock = LatencyStats(), _Clock()
    steps = [(0.4, {"type": "token", "content": "x"}), (0.1, {"type": "done"})]

    with caplog.at_level(logging.INFO, logger="backend.app.shared.latency"):
        _drain(timed("coding", _events(clock, steps), stats=stats, clock=clock))

    line = next(r.getMessage() for r in caplog.records if "latency" in r.getMessage())
    assert "feature=coding" in line and "outcome=done" in line and "total_ms=500" in line
    assert "first_token=400" in line


def test_client_disconnect_still_records_what_happened(caplog):
    stats, clock = LatencyStats(), _Clock()

    async def run():
        stream = timed("chat", _events(clock, [(0.2, {"type": "token", "content": "x"})] * 5), stats=stats, clock=clock)
        async for _ in stream:
            break  # the browser went away after the first token
        await stream.aclose()

    asyncio.run(run())

    assert stats.snapshot()["chat"]["first_token"]["last_ms"] == 200


# ── wired into the real endpoints ───────────────────────────────────────


@pytest.fixture
def client():
    from main import app

    return TestClient(app, headers={CLIENT_HEADER: "test"})


def test_chat_stream_is_timed_and_shown_at_health_latency(client, monkeypatch):
    import backend.app.features.chat.router as chat_router
    from backend.app.shared import latency

    monkeypatch.setattr(latency, "latency", LatencyStats())

    async def fake_stream(req):
        yield {"type": "token", "content": "Chào"}
        yield {"type": "done", "message": "ok"}

    monkeypatch.setattr(chat_router._service, "stream", fake_stream)

    response = client.post("/api/chat/stream", json={"message": "hi", "session_id": "s1"})
    assert response.status_code == 200

    body = client.get("/health/latency").json()
    assert body["chat"]["total"]["count"] == 1
    assert "first_token" in body["chat"]
