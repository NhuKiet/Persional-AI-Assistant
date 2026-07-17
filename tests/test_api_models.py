from fastapi.testclient import TestClient

import backend.app.core.llm as llm_mod
from main import app

client = TestClient(app)


def test_models_endpoint_returns_ollama(monkeypatch):
    monkeypatch.setattr(llm_mod.settings, "ANTHROPIC_API_KEY", None)
    monkeypatch.setattr(llm_mod.settings, "OPENAI_API_KEY", None)
    r = client.get("/api/models")
    assert r.status_code == 200
    body = r.json()
    assert "models" in body and "default" in body
    providers = {m["provider"] for m in body["models"]}
    assert providers == {"ollama"}


def test_default_pair_is_consistent(monkeypatch):
    monkeypatch.setattr(llm_mod.settings, "ANTHROPIC_API_KEY", None)
    monkeypatch.setattr(llm_mod.settings, "OPENAI_API_KEY", None)
    monkeypatch.setattr(llm_mod.settings, "DEFAULT_MODEL", None)
    body = client.get("/api/models").json()
    default = body["default"]
    # the default pair must appear together in the models list
    assert any(
        m["provider"] == default["provider"] and m["model"] == default["model"]
        for m in body["models"]
    )


def test_default_falls_back_when_configured_default_unavailable(monkeypatch):
    # DEFAULT_MODEL points at anthropic, but neither API key is configured —
    # so anthropic (and openai) are absent from `models`. The returned
    # default must not point at an option that isn't actually available.
    monkeypatch.setattr(llm_mod.settings, "ANTHROPIC_API_KEY", None)
    monkeypatch.setattr(llm_mod.settings, "OPENAI_API_KEY", None)
    monkeypatch.setattr(llm_mod.settings, "DEFAULT_PROVIDER", "anthropic")
    monkeypatch.setattr(llm_mod.settings, "DEFAULT_MODEL", "claude-sonnet-5")

    body = client.get("/api/models").json()
    default = body["default"]

    assert any(
        m["provider"] == default["provider"] and m["model"] == default["model"]
        for m in body["models"]
    )
    assert default["provider"] == "ollama"


def test_openai_models_include_gpt41_mini(monkeypatch):
    monkeypatch.setattr(llm_mod.settings, "ANTHROPIC_API_KEY", None)
    monkeypatch.setattr(llm_mod.settings, "OPENAI_API_KEY", "sk-test")
    r = client.get("/api/models")
    assert r.status_code == 200
    models = r.json()["models"]
    openai_ids = {m["model"] for m in models if m["provider"] == "openai"}
    assert "gpt-4.1-mini" in openai_ids
