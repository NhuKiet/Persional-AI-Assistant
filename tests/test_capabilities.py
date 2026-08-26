# tests/test_capabilities.py
import threading

import backend.app.core.capabilities as cap


def test_starts_unknown_for_every_capability():
    snap = cap.snapshot()
    assert set(snap["capabilities"]) == set(cap.CAPABILITIES)
    for state in snap["capabilities"].values():
        assert state["status"] == cap.UNKNOWN
        assert state["total_ok"] == 0
        assert state["total_failed"] == 0
        assert state["last_ok_at"] is None


def test_ok_sets_status_and_counts():
    cap.ok(cap.LLM)
    state = cap.snapshot()["capabilities"][cap.LLM]
    assert state["status"] == cap.OK
    assert state["total_ok"] == 1
    assert state["last_ok_at"] is not None


def test_failed_sets_status_error_and_counts():
    cap.failed(cap.RERANKER, "XLMRobertaTokenizer has no attribute prepare_for_model")
    state = cap.snapshot()["capabilities"][cap.RERANKER]
    assert state["status"] == cap.DEGRADED
    assert state["total_failed"] == 1
    assert state["consecutive_failures"] == 1
    assert "prepare_for_model" in state["last_error"]
    assert state["last_error_at"] is not None


def test_consecutive_failures_reset_on_success_but_totals_do_not():
    for _ in range(3):
        cap.failed(cap.EMBEDDINGS, "rate limited")
    cap.ok(cap.EMBEDDINGS)
    state = cap.snapshot()["capabilities"][cap.EMBEDDINGS]
    assert state["consecutive_failures"] == 0
    assert state["total_failed"] == 3
    assert state["total_ok"] == 1


def test_dead_capability_is_distinguishable_from_a_flaky_one():
    """The signal that would have ended the reranker outage in minutes."""
    for _ in range(50):
        cap.failed(cap.RERANKER, "cannot score")
    for _ in range(25):
        cap.failed(cap.EMBEDDINGS, "rate limited")
        cap.ok(cap.EMBEDDINGS)

    dead = cap.snapshot()["capabilities"][cap.RERANKER]
    flaky = cap.snapshot()["capabilities"][cap.EMBEDDINGS]
    assert dead["total_ok"] == 0 and dead["consecutive_failures"] == 50
    assert flaky["total_ok"] == 25 and flaky["consecutive_failures"] == 0


def test_last_error_is_truncated():
    cap.failed(cap.LLM, "x" * 500)
    assert len(cap.snapshot()["capabilities"][cap.LLM]["last_error"]) == 200


def test_disabled_survives_a_failure_report():
    """A switched-off capability reported as broken trains operators to
    dismiss warnings."""
    cap.disabled(cap.RERANKER)
    cap.failed(cap.RERANKER, "not configured")
    state = cap.snapshot()["capabilities"][cap.RERANKER]
    assert state["status"] == cap.DISABLED
    assert state["total_failed"] == 1     # still counted


def test_disabled_is_cleared_by_a_real_success():
    """Evidently it works, so it is evidently not switched off."""
    cap.disabled(cap.RERANKER)
    cap.ok(cap.RERANKER)
    assert cap.snapshot()["capabilities"][cap.RERANKER]["status"] == cap.OK


def test_aggregate_status_degrades_on_any_degraded_capability():
    assert cap.snapshot()["status"] == cap.OK
    cap.failed(cap.KNOWLEDGE_STORE, "503")
    assert cap.snapshot()["status"] == cap.DEGRADED


def test_aggregate_status_ignores_unknown_and_disabled():
    cap.disabled(cap.RERANKER)
    cap.ok(cap.LLM)
    # embeddings and knowledge_store remain unknown
    assert cap.snapshot()["status"] == cap.OK


def test_concurrent_reports_lose_no_counts():
    def report():
        for _ in range(200):
            cap.ok(cap.LLM)

    threads = [threading.Thread(target=report) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert cap.snapshot()["capabilities"][cap.LLM]["total_ok"] == 1600
