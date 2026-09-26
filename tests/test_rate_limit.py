"""Per-client rate limit on endpoints that spend money or GPU time.

Session locks stop two streams on the SAME session; nothing stopped a client
from rotating session ids and firing requests as fast as it likes. Two tiers:
research (a search fan-out plus several LLM calls per request) is limited
harder than everything else that calls an LLM or the HMER model.
"""
import pytest
from fastapi.testclient import TestClient

import backend.app.features.chat.router as chat_router
from backend.app.core import rate_limit
from backend.app.core.config import settings
from backend.app.core.csrf import CLIENT_HEADER
from main import app


class _Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


# ── SlidingWindowLimiter ────────────────────────────────────────────────────

def test_allows_up_to_the_limit_then_reports_wait():
    clock = _Clock()
    limiter = rate_limit.SlidingWindowLimiter(window=60.0, clock=clock)

    assert [limiter.hit(("c", "t"), 3) for _ in range(3)] == [0.0, 0.0, 0.0]
    clock.now += 10
    assert limiter.hit(("c", "t"), 3) == pytest.approx(50.0)


def test_slot_frees_once_the_oldest_hit_leaves_the_window():
    clock = _Clock()
    limiter = rate_limit.SlidingWindowLimiter(window=60.0, clock=clock)
    for _ in range(2):
        limiter.hit(("c", "t"), 2)

    clock.now += 60
    assert limiter.hit(("c", "t"), 2) == 0.0


def test_refused_hits_do_not_extend_the_wait():
    clock = _Clock()
    limiter = rate_limit.SlidingWindowLimiter(window=60.0, clock=clock)
    limiter.hit(("c", "t"), 1)
    for _ in range(5):
        clock.now += 1
        limiter.hit(("c", "t"), 1)

    clock.now = 1060.0
    assert limiter.hit(("c", "t"), 1) == 0.0


def test_clients_and_tiers_are_counted_separately():
    limiter = rate_limit.SlidingWindowLimiter(window=60.0, clock=_Clock())
    assert limiter.hit(("a", "t"), 1) == 0.0
    assert limiter.hit(("b", "t"), 1) == 0.0
    assert limiter.hit(("a", "other"), 1) == 0.0
    assert limiter.hit(("a", "t"), 1) > 0


# ── Wired into the app ──────────────────────────────────────────────────────

@pytest.fixture
def stub_chat(monkeypatch):
    async def token_stream(**_kwargs):
        yield "ok"

    monkeypatch.setattr(chat_router._conv_manager, "chat_stream", token_stream)


def _post_chat(i):
    return TestClient(app, headers={CLIENT_HEADER: "test"}).post(
        "/api/chat/stream", json={"message": "hi", "session_id": f"rl-{i}"},
    )


def test_expensive_endpoint_returns_429_with_retry_after(stub_chat, monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_PER_MINUTE", 2)

    assert [_post_chat(i).status_code for i in range(2)] == [200, 200]
    refused = _post_chat(3)

    assert refused.status_code == 429
    assert 1 <= int(refused.headers["retry-after"]) <= 60
    assert "thử lại sau" in refused.json()["detail"]


def test_rotating_session_ids_does_not_bypass_the_limit(stub_chat, monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_PER_MINUTE", 3)
    codes = [_post_chat(i).status_code for i in range(5)]
    assert codes == [200, 200, 200, 429, 429]


def test_research_has_its_own_stricter_budget(monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_RESEARCH_PER_MINUTE", 1)
    monkeypatch.setattr(settings, "RATE_LIMIT_PER_MINUTE", 100)
    client = TestClient(app, headers={CLIENT_HEADER: "test"})

    # An unlisted model is refused with 400 after the limiter has counted
    # it — a cheap way to spend the budget without starting a real run.
    body = {"query": "q", "provider": "openai", "model": "gpt-9-ultra"}
    assert client.post("/api/research/stream", json=body).status_code == 400
    assert client.post("/api/research/stream", json=body).status_code == 429
    # The general tier is untouched.
    assert client.post("/api/chat/stream", json={
        "message": "hi", "provider": "openai", "model": "gpt-9-ultra",
    }).status_code == 400


def test_limit_can_be_switched_off(stub_chat, monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_ENABLED", False)
    monkeypatch.setattr(settings, "RATE_LIMIT_PER_MINUTE", 1)
    assert [_post_chat(i).status_code for i in range(3)] == [200, 200, 200]


def test_cheap_reads_are_not_limited(monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_PER_MINUTE", 1)
    client = TestClient(app)
    assert [client.get("/api/models").status_code for _ in range(5)] == [200] * 5


@pytest.mark.parametrize("path", [
    "/api/chat/stream", "/api/research/deep-dive", "/api/coding/stream",
    "/api/pdf/stream", "/api/pdf/summarize", "/api/pdf/suggestions", "/api/bubble/chat",
    "/api/hmer/recognize", "/api/hmer/explain", "/api/research/stream",
])
def test_every_expensive_endpoint_is_limited(path, monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_PER_MINUTE", 0)
    monkeypatch.setattr(settings, "RATE_LIMIT_RESEARCH_PER_MINUTE", 0)
    response = TestClient(app, headers={CLIENT_HEADER: "test"}).post(path, json={})
    assert response.status_code == 429
