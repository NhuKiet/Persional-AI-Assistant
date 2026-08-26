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

    def _boom(*a, **k):
        raise RuntimeError("provider down")

    monkeypatch.setattr(llm_mod, "get_llm", _boom)

    with pytest.raises(RuntimeError, match="provider down"):
        llm_mod.invoke_chat("p")
    assert cap.snapshot()["capabilities"][cap.LLM]["status"] == cap.DEGRADED
