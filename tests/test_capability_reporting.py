"""Each boundary must report AND keep its exact current behavior.

The behavior half matters more than the reporting half: adding observability
that quietly changes control flow would introduce the very class of bug this
work exists to catch.
"""
import pytest

import backend.app.core.capabilities as cap


# ── embeddings: raise to caller ──────────────────────────────────────────────

def test_embed_texts_reports_ok(monkeypatch):
    import backend.app.features.research.embeddings as emb

    monkeypatch.setattr(emb, "_get_backend", lambda: type(
        "B", (), {"embed_documents": lambda self, t: [[0.1]] * len(t)}
    )())
    assert emb.embed_texts(["a", "b"]) == [[0.1], [0.1]]
    assert cap.snapshot()["capabilities"][cap.EMBEDDINGS]["status"] == cap.OK


def test_embed_texts_reports_failure_and_reraises(monkeypatch):
    import backend.app.features.research.embeddings as emb

    class _Boom:
        def embed_documents(self, texts):
            raise RuntimeError("rate limited")

    monkeypatch.setattr(emb, "_get_backend", lambda: _Boom())

    with pytest.raises(RuntimeError, match="rate limited"):
        emb.embed_texts(["a"])

    state = cap.snapshot()["capabilities"][cap.EMBEDDINGS]
    assert state["status"] == cap.DEGRADED
    assert "rate limited" in state["last_error"]


def test_embed_texts_empty_input_reports_nothing(monkeypatch):
    """No call was made, so there is nothing to observe."""
    import backend.app.features.research.embeddings as emb

    assert emb.embed_texts([]) == []
    state = cap.snapshot()["capabilities"][cap.EMBEDDINGS]
    assert state["status"] == cap.UNKNOWN
    assert state["total_ok"] == 0


def test_embed_query_reports_failure_and_reraises(monkeypatch):
    import backend.app.features.research.embeddings as emb

    class _Boom:
        def embed_query(self, text):
            raise RuntimeError("no api key")

    monkeypatch.setattr(emb, "_get_backend", lambda: _Boom())

    with pytest.raises(RuntimeError, match="no api key"):
        emb.embed_query("q")
    assert cap.snapshot()["capabilities"][cap.EMBEDDINGS]["status"] == cap.DEGRADED


# ── llm: invoke_chat raises to caller ────────────────────────────────────────

def test_invoke_chat_reports_ok(monkeypatch):
    import backend.app.core.llm as llm_mod

    class _R:
        content = "hello"

    monkeypatch.setattr(llm_mod, "get_llm",
                        lambda *a, **k: type("L", (), {"invoke": lambda self, m: _R()})())
    assert llm_mod.invoke_chat("p") == "hello"
    assert cap.snapshot()["capabilities"][cap.LLM]["status"] == cap.OK


def test_invoke_chat_reports_a_missing_api_key(monkeypatch):
    """A key that is not configured means the LLM genuinely cannot be used."""
    import backend.app.core.llm as llm_mod

    monkeypatch.setattr(llm_mod.settings, "DEFAULT_PROVIDER", "openai")
    monkeypatch.setattr(llm_mod.settings, "OPENAI_API_KEY", None)

    with pytest.raises(llm_mod.MissingProviderKey):
        llm_mod.invoke_chat("p")
    assert cap.snapshot()["capabilities"][cap.LLM]["status"] == cap.DEGRADED


def test_invoke_chat_does_not_blame_the_provider_for_a_caller_error():
    """An unrecognized provider string is a caller error, not an outage."""
    import backend.app.core.llm as llm_mod

    with pytest.raises(ValueError, match="Provider không hỗ trợ"):
        llm_mod.invoke_chat("p", provider="not-a-real-provider")

    state = cap.snapshot()["capabilities"][cap.LLM]
    assert state["status"] == cap.UNKNOWN
    assert state["total_failed"] == 0


def test_invoke_chat_still_reports_a_real_provider_failure(monkeypatch):
    """Narrowing the try must not stop real outages being recorded."""
    import backend.app.core.llm as llm_mod

    class _LLM:
        def invoke(self, messages):
            raise RuntimeError("connection reset by peer")

    monkeypatch.setattr(llm_mod, "get_llm", lambda *a, **k: _LLM())

    with pytest.raises(RuntimeError, match="connection reset"):
        llm_mod.invoke_chat("p")
    assert cap.snapshot()["capabilities"][cap.LLM]["status"] == cap.DEGRADED


# ── llm: Synthesizer._call swallows ──────────────────────────────────────────

def _synth():
    from backend.app.core.llm import ModelCapabilities
    from backend.app.features.research.synthesizer import Synthesizer

    class _LLM:
        def invoke(self, prompt):
            raise RuntimeError("provider down")

    return Synthesizer(llm=_LLM(), capabilities=ModelCapabilities(8192, False, True))


def test_call_still_returns_empty_string_on_failure():
    s = _synth()
    assert s._call("p") == ""
    assert cap.snapshot()["capabilities"][cap.LLM]["status"] == cap.DEGRADED


def test_call_reports_ok_on_success():
    from backend.app.core.llm import ModelCapabilities
    from backend.app.features.research.synthesizer import Synthesizer

    class _R:
        content = "text"

    class _LLM:
        def invoke(self, prompt):
            return _R()

    s = Synthesizer(llm=_LLM(), capabilities=ModelCapabilities(8192, False, True))
    assert s._call("p") == "text"
    assert cap.snapshot()["capabilities"][cap.LLM]["status"] == cap.OK


# ── reranker: cross_encoder_scores swallows ──────────────────────────────────

def test_cross_encoder_reports_ok_when_it_scores(monkeypatch):
    import backend.app.features.research.reranker as rr

    monkeypatch.setattr(rr.settings, "COHERE_API_KEY", None, raising=False)
    monkeypatch.setattr(rr, "_bge_reranker", lambda: type(
        "M", (), {"predict": lambda self, pairs: [0.5] * len(pairs)}
    )())

    assert rr.cross_encoder_scores("q", ["d"]) == [0.5]
    assert cap.snapshot()["capabilities"][cap.RERANKER]["status"] == cap.OK


def test_cross_encoder_reports_degraded_and_still_returns_none(monkeypatch):
    import backend.app.features.research.reranker as rr

    monkeypatch.setattr(rr.settings, "COHERE_API_KEY", None, raising=False)
    monkeypatch.setattr(rr, "_bge_reranker", lambda: None)

    assert rr.cross_encoder_scores("q", ["d"]) is None
    assert cap.snapshot()["capabilities"][cap.RERANKER]["status"] == cap.DEGRADED


def test_cross_encoder_empty_docs_reports_nothing(monkeypatch):
    """Returns None because there was nothing to do — not a failure."""
    import backend.app.features.research.reranker as rr

    assert rr.cross_encoder_scores("q", []) is None
    state = cap.snapshot()["capabilities"][cap.RERANKER]
    assert state["status"] == cap.UNKNOWN
    assert state["total_failed"] == 0


# ── knowledge store: handlers swallow ────────────────────────────────────────

def test_get_weaviate_reports_and_reraises_on_connection_failure(monkeypatch):
    """Reporting lives at the boundary, so the test measures it at the
    boundary. Patching _get_weaviate out would patch out the reporting too."""
    import weaviate

    import backend.app.features.research.knowledge_store as ks

    monkeypatch.setattr(ks, "_client", None)
    monkeypatch.setattr(ks.settings, "WEAVIATE_URL", "https://x.example", raising=False)
    monkeypatch.setattr(ks.settings, "WEAVIATE_API_KEY", "k", raising=False)

    def _boom(**kwargs):
        raise RuntimeError("Meta endpoint! Unexpected status code: 503")

    monkeypatch.setattr(weaviate, "connect_to_weaviate_cloud", _boom)

    with pytest.raises(RuntimeError, match="503"):
        ks._get_weaviate()

    state = cap.snapshot()["capabilities"][cap.KNOWLEDGE_STORE]
    assert state["status"] == cap.DEGRADED
    assert "503" in state["last_error"]


def test_retrieve_candidates_still_returns_empty_when_connection_fails(monkeypatch):
    """Behavior preservation only. This handler deliberately reports nothing —
    it catches _get_weaviate and embed_query together and cannot attribute a
    failure to either, so both report from their own boundary instead."""
    import backend.app.features.research.knowledge_store as ks

    def _boom():
        raise RuntimeError("Meta endpoint! Unexpected status code: 503")

    monkeypatch.setattr(ks, "_get_weaviate", _boom)
    assert ks.KnowledgeStore().retrieve_candidates("q") == []


def test_size_reports_ok_on_a_successful_count(monkeypatch):
    """The boot probe calls size(); if it reports nothing, the probe leaves
    knowledge_store 'unknown' and does not do its job."""
    import backend.app.features.research.knowledge_store as ks

    class _Agg:
        def over_all(self, total_count=True):
            return type("R", (), {"total_count": 42})()

    class _Col:
        aggregate = _Agg()

    class _Collections:
        def get(self, name):
            return _Col()

    class _Client:
        collections = _Collections()

    monkeypatch.setattr(ks, "_get_weaviate", lambda: _Client())

    assert ks.KnowledgeStore().size() == 42
    assert cap.snapshot()["capabilities"][cap.KNOWLEDGE_STORE]["status"] == cap.OK


def test_size_does_not_double_report_a_connection_failure(monkeypatch):
    """_get_weaviate reports from its own boundary. Counting it again here
    would inflate total_failed and blur dead-versus-flaky."""
    import backend.app.features.research.knowledge_store as ks

    def _boom():
        raise RuntimeError("503 no healthy upstream")

    monkeypatch.setattr(ks, "_get_weaviate", _boom)

    assert ks.KnowledgeStore().size() == 0
    assert cap.snapshot()["capabilities"][cap.KNOWLEDGE_STORE]["total_failed"] == 0


def test_size_reports_a_query_failure_after_a_good_connection(monkeypatch):
    """The connection succeeded, so a failure past that point is the store's
    and nobody else has reported it."""
    import backend.app.features.research.knowledge_store as ks

    class _Col:
        @property
        def aggregate(self):
            raise RuntimeError("aggregate timed out")

    class _Collections:
        def get(self, name):
            return _Col()

    class _Client:
        collections = _Collections()

    monkeypatch.setattr(ks, "_get_weaviate", lambda: _Client())

    assert ks.KnowledgeStore().size() == 0
    state = cap.snapshot()["capabilities"][cap.KNOWLEDGE_STORE]
    assert state["status"] == cap.DEGRADED
    assert state["total_failed"] == 1
    assert "aggregate timed out" in state["last_error"]
