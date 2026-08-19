# tests/test_model_capabilities.py
import backend.app.core.llm as llm_mod
from backend.app.core.llm import capabilities_for


def test_known_model_capabilities():
    caps = capabilities_for("openai", "gpt-5.6-luna")
    assert caps.context_window == 1_050_000
    assert caps.supports_structured_output is True
    assert caps.supports_temperature is False
    assert "high" in caps.reasoning_effort_levels


def test_unknown_model_falls_back_to_conservative_default():
    caps = capabilities_for("ollama", "some-random-local-model")
    assert caps.context_window == 8192
    assert caps.supports_structured_output is False
    assert caps.supports_temperature is True
    assert caps.reasoning_effort_levels == ()


def test_capabilities_resolve_through_default_model(monkeypatch):
    monkeypatch.setattr(llm_mod.settings, "DEFAULT_PROVIDER", "openai")
    monkeypatch.setattr(llm_mod.settings, "DEFAULT_MODEL", "gpt-5.6-luna")
    assert capabilities_for().context_window == 1_050_000


def test_capabilities_ignore_default_model_of_another_provider(monkeypatch):
    monkeypatch.setattr(llm_mod.settings, "DEFAULT_PROVIDER", "openai")
    monkeypatch.setattr(llm_mod.settings, "DEFAULT_MODEL", "gpt-5.6-luna")
    caps = capabilities_for("anthropic")
    assert caps.context_window == 200_000


def test_resolve_model_matches_get_llm_defaults(monkeypatch):
    monkeypatch.setattr(llm_mod.settings, "DEFAULT_PROVIDER", "ollama")
    monkeypatch.setattr(llm_mod.settings, "DEFAULT_MODEL", None)
    monkeypatch.setattr(llm_mod.settings, "OLLAMA_MODEL", "llama3")
    assert llm_mod._resolve_model("ollama", None) == "llama3"
    assert llm_mod._resolve_model("openai", None) == "gpt-4o-mini"
    assert llm_mod._resolve_model("anthropic", None) == "claude-sonnet-5"
    assert llm_mod._resolve_model("openai", "gpt-4o") == "gpt-4o"
