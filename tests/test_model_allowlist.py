"""Clients may only pick a (provider, model) pair the server offers through
GET /api/models. Anything else — an unlisted, pricier model id, a provider
without a key — is refused with 400 before a session lock, a search fan-out
or a paid LLM call happens.
"""
import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from backend.app.core.config import settings
from backend.app.core.csrf import CLIENT_HEADER
from backend.app.core.llm import ModelNotAllowed, check_model_allowed
from main import app


@pytest.fixture
def keys(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", None)
    monkeypatch.setattr(settings, "DEFAULT_PROVIDER", "openai")
    monkeypatch.setattr(settings, "DEFAULT_MODEL", "gpt-5.6-luna")
    monkeypatch.setattr(settings, "OLLAMA_MODEL", "llama3")


@pytest.mark.parametrize("provider,model", [
    ("openai", "gpt-4o-mini"),
    ("OpenAI", "gpt-4o-mini"),
    ("ollama", "llama3"),
    ("openai", None),
    (None, None),
])
def test_listed_and_default_models_are_allowed(keys, provider, model):
    check_model_allowed(provider, model)


@pytest.mark.parametrize("provider,model", [
    ("openai", "gpt-9-ultra"),         # not in the registry
    ("openai", "o1-pro"),
    ("anthropic", "claude-sonnet-5"),  # in the registry, but no key configured
    ("ollama", "llama3:70b"),          # only the configured local model
    ("gemini", "gemini-pro"),          # unknown provider
    (None, "gpt-9-ultra"),             # default provider, unlisted model
])
def test_unlisted_models_are_refused(keys, provider, model):
    with pytest.raises(ModelNotAllowed):
        check_model_allowed(provider, model)


def test_server_default_is_allowed_even_when_not_in_registry(keys, monkeypatch):
    # The operator picked it in .env; only client choices are restricted.
    monkeypatch.setattr(settings, "DEFAULT_MODEL", "gpt-4.1")
    check_model_allowed(None, None)
    check_model_allowed("openai", "gpt-4.1")


# Every endpoint whose body carries provider/model, with a minimal valid body.
_MODEL_ENDPOINTS = {
    "/api/chat/stream": {"message": "hi"},
    "/api/research/stream": {"query": "q"},
    "/api/research/deep-dive": {"question": "q", "source_content": "c"},
    "/api/coding/stream": {"message": "hi"},
    "/api/pdf/stream": {"message": "hi", "filename": "a.pdf"},
    "/api/pdf/summarize": {"filename": "a.pdf"},
    "/api/pdf/suggestions": {"filename": "a.pdf"},
}


@pytest.mark.parametrize("path,body", _MODEL_ENDPOINTS.items())
def test_endpoint_refuses_unlisted_model_before_streaming(keys, path, body):
    client = TestClient(app, headers={CLIENT_HEADER: "test"})
    response = client.post(path, json={**body, "provider": "openai", "model": "gpt-9-ultra"})

    assert response.status_code == 400
    assert response.headers["content-type"].startswith("application/json")
    assert "gpt-9-ultra" in response.json()["detail"]


def test_every_endpoint_that_accepts_a_model_is_guarded():
    """A new route taking provider/model must join _MODEL_ENDPOINTS above,
    which makes the guard test cover it."""
    found = {
        route.path
        for route in app.routes
        if isinstance(route, APIRoute)
        for param in route.dependant.body_params
        if {"provider", "model"} & set(getattr(param.field_info.annotation, "model_fields", {}))
    }
    assert found == set(_MODEL_ENDPOINTS)
