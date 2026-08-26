# tests/test_health_endpoints.py
from fastapi.testclient import TestClient

import backend.app.core.capabilities as cap
from backend.app.main import app


def test_health_is_200_and_ok_when_nothing_is_degraded():
    r = TestClient(app).get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert "version" in r.json()


def test_health_reports_degraded_but_still_returns_200():
    """Liveness is not capability health: a 503 here would let a load balancer
    kill a process that is serving correctly."""
    cap.failed(cap.RERANKER, "cannot score")

    r = TestClient(app).get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "degraded"


def test_health_stays_ok_for_unknown_and_disabled():
    cap.disabled(cap.RERANKER)
    cap.ok(cap.LLM)

    assert TestClient(app).get("/health").json()["status"] == "ok"


def test_capabilities_endpoint_lists_all_four_always():
    cap.failed(cap.KNOWLEDGE_STORE, "503 no healthy upstream")

    body = TestClient(app).get("/health/capabilities").json()
    assert body["status"] == "degraded"
    assert set(body["capabilities"]) == set(cap.CAPABILITIES)

    store = body["capabilities"][cap.KNOWLEDGE_STORE]
    assert store["status"] == "degraded"
    assert store["total_failed"] == 1
    assert "503" in store["last_error"]

    # An unexercised capability is present and honest about being unexercised.
    assert body["capabilities"][cap.LLM]["status"] == "unknown"


def test_capabilities_endpoint_exposes_the_dead_capability_signal():
    """total_ok 0 beside a climbing failure count is the line that identifies a
    dead capability rather than a flaky one."""
    for _ in range(20):
        cap.failed(cap.RERANKER, "cannot score")

    state = TestClient(app).get("/health/capabilities").json()["capabilities"][cap.RERANKER]
    assert state["total_ok"] == 0
    assert state["consecutive_failures"] == 20
