"""The knowledge store is a cache: when Weaviate is asleep, expired or slow it
must cost a research request almost nothing.

Measured against a sleeping Weaviate Cloud cluster: every connect attempt
took 0.9–1.6 s to come back 503, twice per research request, and the first
lookup after the cluster woke took 22.7 s under the client's 30 s default.
"""
import pytest
import weaviate

import backend.app.core.capabilities as cap
import backend.app.features.research.knowledge_store as ks


@pytest.fixture
def clock(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(ks, "_clock", lambda: now[0])
    return now


@pytest.fixture
def cloud(monkeypatch):
    """A configured store with no client yet; `calls` records each connect."""
    monkeypatch.setattr(ks, "_client", None)
    monkeypatch.setattr(ks.settings, "WEAVIATE_URL", "https://x.example", raising=False)
    monkeypatch.setattr(ks.settings, "WEAVIATE_API_KEY", "k", raising=False)
    calls = []

    def connect(**kwargs):
        calls.append(kwargs)
        raise RuntimeError("Meta endpoint! Unexpected status code: 503, with response body: None.")

    monkeypatch.setattr(weaviate, "connect_to_weaviate_cloud", connect)
    return calls


def knowledge_state() -> dict:
    return cap.snapshot()["capabilities"][cap.KNOWLEDGE_STORE]


def test_a_failed_connection_is_not_retried_on_the_next_call(cloud, clock):
    with pytest.raises(RuntimeError, match="503"):
        ks._get_weaviate()

    with pytest.raises(ks.KnowledgeStoreUnavailable):
        ks._get_weaviate()

    assert len(cloud) == 1
    assert knowledge_state()["total_failed"] == 1  # one outage, counted once


def test_the_connection_is_tried_again_once_the_pause_is_over(cloud, clock):
    with pytest.raises(RuntimeError):
        ks._get_weaviate()

    clock[0] += ks.RETRY_AFTER_SECONDS + 1
    with pytest.raises(RuntimeError, match="503"):
        ks._get_weaviate()

    assert len(cloud) == 2


def test_a_503_says_the_cluster_is_asleep_or_expired(cloud, clock):
    with pytest.raises(RuntimeError):
        ks._get_weaviate()

    error = knowledge_state()["last_error"]
    assert "đang ngủ hoặc đã hết hạn" in error
    assert "503" in error


def test_lookups_get_a_short_deadline(cloud, clock):
    with pytest.raises(RuntimeError):
        ks._get_weaviate()

    timeout = cloud[0]["additional_config"].timeout
    assert timeout.query == ks.settings.KNOWLEDGE_QUERY_TIMEOUT == 6
    assert timeout.init == 5


def test_a_paused_store_answers_empty_without_paying_for_an_embedding(cloud, clock, monkeypatch):
    embedded = []
    monkeypatch.setattr(ks, "embed_query", lambda text: embedded.append(text) or [0.0])
    with pytest.raises(RuntimeError):
        ks._get_weaviate()

    assert ks.KnowledgeStore().retrieve_candidates("q") == []
    assert ks.KnowledgeStore().add_results("q", []) == 0
    assert embedded == []
    assert len(cloud) == 1


def test_a_failing_query_pauses_the_store_too(clock, monkeypatch):
    # The cluster went to sleep while a client was already connected.
    class _Asleep:
        class collections:
            @staticmethod
            def get(_name):
                raise RuntimeError("no healthy upstream")

    monkeypatch.setattr(ks, "_client", _Asleep())
    monkeypatch.setattr(ks, "embed_query", lambda text: [0.0])

    assert ks.KnowledgeStore().retrieve_candidates("q") == []

    with pytest.raises(ks.KnowledgeStoreUnavailable):
        ks._get_weaviate()
    clock[0] += ks.RETRY_AFTER_SECONDS + 1
    assert isinstance(ks._get_weaviate(), _Asleep)  # the same client is tried again
