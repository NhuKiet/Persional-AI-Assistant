import pytest

import backend.app.features.research.embeddings as emb


def test_embed_texts_calls_backend(monkeypatch):
    monkeypatch.setattr(emb.settings, "OPENAI_API_KEY", "sk-test")

    class FakeBackend:
        def embed_documents(self, texts):
            return [[0.1, 0.2, 0.3] for _ in texts]
        def embed_query(self, text):
            return [0.4, 0.5, 0.6]

    monkeypatch.setattr(emb, "_get_backend", lambda: FakeBackend())
    vecs = emb.embed_texts(["a", "b"])
    assert len(vecs) == 2 and vecs[0] == [0.1, 0.2, 0.3]
    assert emb.embed_query("q") == [0.4, 0.5, 0.6]


def test_embed_raises_without_key(monkeypatch):
    monkeypatch.setattr(emb.settings, "OPENAI_API_KEY", None)
    monkeypatch.setattr(emb, "_backend", None)  # reset singleton
    with pytest.raises(RuntimeError):
        emb.embed_texts(["a"])
