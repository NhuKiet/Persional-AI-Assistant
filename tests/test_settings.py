import importlib

from backend.app.core.config import Settings


def test_defaults_match_current_env_getenv():
    s = Settings(_env_file=None)
    assert s.OLLAMA_URL == "http://localhost:11434"
    assert s.OLLAMA_MODEL == "llama3"
    assert s.LLM_NUM_GPU == 99
    assert s.MAX_HISTORY == 20
    assert s.DEFAULT_PROVIDER == "ollama"
    assert s.ANTHROPIC_API_KEY is None
    assert s.KNOWLEDGE_TOP_K == 40
    assert s.OPENAI_EMBEDDING_MODEL == "text-embedding-3-small"


def test_reads_from_env(monkeypatch):
    monkeypatch.setenv("OLLAMA_MODEL", "mistral")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("DEFAULT_PROVIDER", "anthropic")
    s = Settings(_env_file=None)
    assert s.OLLAMA_MODEL == "mistral"
    assert s.ANTHROPIC_API_KEY == "sk-test"
    assert s.DEFAULT_PROVIDER == "anthropic"


def test_invalid_provider_rejected():
    import pytest
    with pytest.raises(ValueError):
        Settings(_env_file=None, DEFAULT_PROVIDER="gemini")


def test_singleton_importable():
    mod = importlib.import_module("backend.app.core.config")
    assert mod.settings.OLLAMA_MODEL  # non-empty


def test_weaviate_and_embedding_defaults():
    s = Settings(_env_file=None)
    assert s.WEAVIATE_URL is None
    assert s.WEAVIATE_API_KEY is None
    assert s.OPENAI_EMBEDDING_MODEL == "text-embedding-3-small"


def test_weaviate_reads_from_env(monkeypatch):
    monkeypatch.setenv("WEAVIATE_URL", "https://x.weaviate.cloud")
    monkeypatch.setenv("WEAVIATE_API_KEY", "wv-key")
    s = Settings(_env_file=None)
    assert s.WEAVIATE_URL == "https://x.weaviate.cloud"
    assert s.WEAVIATE_API_KEY == "wv-key"


def test_rerank_defaults():
    s = Settings(_env_file=None)
    assert s.COHERE_API_KEY is None
    assert s.RERANK_ENABLED is True
    assert s.RERANK_GATE_THRESHOLD == 0.5
    assert s.RERANK_CANDIDATES == 30


def test_executor_mode_defaults_to_docker():
    s = Settings(_env_file=None)
    assert s.EXECUTOR_MODE == "docker"


def test_executor_mode_rejects_non_docker_values():
    import pytest
    with pytest.raises(ValueError):
        Settings(_env_file=None, EXECUTOR_MODE="subprocess")
    with pytest.raises(ValueError):
        Settings(_env_file=None, EXECUTOR_MODE="host")
