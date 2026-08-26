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


def test_invoke_chat_reports_failure_and_reraises(monkeypatch):
    import backend.app.core.llm as llm_mod

    class _LLM:
        def invoke(self, messages):
            raise RuntimeError("provider down")

    monkeypatch.setattr(llm_mod, "get_llm", lambda *a, **k: _LLM())

    with pytest.raises(RuntimeError, match="provider down"):
        llm_mod.invoke_chat("p")
    assert cap.snapshot()["capabilities"][cap.LLM]["status"] == cap.DEGRADED


def test_invoke_chat_reports_a_missing_api_key(monkeypatch):
    """A key that is not configured means the LLM genuinely cannot be used."""
    import backend.app.core.llm as llm_mod

    monkeypatch.setattr(llm_mod.settings, "DEFAULT_PROVIDER", "openai")
    monkeypatch.setattr(llm_mod.settings, "OPENAI_API_KEY", None)

    with pytest.raises(ValueError, match="chưa cấu hình"):
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
