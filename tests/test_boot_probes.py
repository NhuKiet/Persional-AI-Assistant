"""The startup probe (core/lifespan._seed_capabilities) on a host where the
cross-encoder is switched off on purpose — the hosted deploy, which has no
room for the ~2 GB model."""
import backend.app.core.lifespan as lifespan_mod
from backend.app.core import capabilities
from backend.app.core.config import settings


def _quiet_probes(monkeypatch):
    import backend.app.features.research.embeddings as embeddings_mod
    import backend.app.features.research.knowledge_store as store_mod

    class _Store:
        def size(self):
            return 0

    monkeypatch.setattr(embeddings_mod, "embed_query", lambda text: [0.0])
    monkeypatch.setattr(store_mod, "get_store", lambda: _Store())


def test_a_reranker_switched_off_is_reported_disabled_without_loading_it(monkeypatch):
    import backend.app.features.research.reranker as reranker_mod

    def never():
        raise AssertionError("the probe must not load a model that is switched off")

    _quiet_probes(monkeypatch)
    monkeypatch.setattr(reranker_mod, "reranker_selfcheck", never)
    monkeypatch.setattr(settings, "RERANK_ENABLED", False)

    lifespan_mod._seed_capabilities()

    assert capabilities.snapshot()["capabilities"]["reranker"]["status"] == capabilities.DISABLED


def test_no_handwriting_checkpoint_is_reported_disabled_at_boot(monkeypatch):
    _quiet_probes(monkeypatch)
    monkeypatch.setattr(settings, "RERANK_ENABLED", False)
    monkeypatch.setattr(settings, "HMER_CHECKPOINT", "")

    lifespan_mod._seed_capabilities()

    assert capabilities.snapshot()["capabilities"]["hmer"]["status"] == capabilities.DISABLED


def test_a_reranker_that_fails_its_check_is_still_reported_broken(monkeypatch):
    import backend.app.features.research.reranker as reranker_mod

    _quiet_probes(monkeypatch)
    monkeypatch.setattr(reranker_mod, "reranker_selfcheck", lambda: "reranker model unavailable")
    monkeypatch.setattr(settings, "RERANK_ENABLED", True)

    lifespan_mod._seed_capabilities()

    assert capabilities.snapshot()["capabilities"]["reranker"]["status"] == capabilities.DEGRADED
