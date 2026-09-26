"""A dead database is an outage, not a crash: 503 with a readable reason.

Before, psycopg's PoolTimeout escaped the handler. Starlette turns an
unhandled exception into a bare 500 from its outermost middleware — outside
CORS — so the browser saw only a network error and the UI couldn't say why.
"""
import psycopg
import psycopg_pool
import pytest
from fastapi.testclient import TestClient

import backend.app.shared.conversation_store as conv_mod
from backend.app.core.config import settings
from backend.app.core.csrf import CLIENT_HEADER
from main import app
from tests.fake_session_store import FakeSessionStore

_VITE_ORIGIN = "http://localhost:5173"


class _DownStore(FakeSessionStore):
    def __init__(self, exc):
        super().__init__()
        self._exc = exc

    def load_with_revision(self, key):
        raise self._exc

    def save(self, key, messages):
        raise self._exc

    def delete(self, key):
        raise self._exc


_OUTAGES = [
    psycopg_pool.PoolTimeout("pool initialization incomplete after 3.0 sec"),
    psycopg.OperationalError("connection refused: db.internal.example.com:5432"),
]

_SESSION_ENDPOINTS = [
    ("GET", "/api/chat/sessions/s1"),
    ("DELETE", "/api/chat/session/s1"),
    ("GET", "/api/coding/sessions/s1"),
    ("DELETE", "/api/coding/session/s1"),
    ("GET", "/api/pdf/sessions/s1"),
    ("DELETE", "/api/pdf/file/not-there.pdf?session_id=s1"),
    ("GET", "/api/research/sessions/s1"),
]


def _assert_readable_503(response):
    assert response.status_code == 503
    assert response.json()["code"] == "storage_unavailable"
    assert response.json()["detail"].strip()
    # CORS headers present, so the frontend can read the reason...
    assert response.headers["access-control-allow-origin"] == _VITE_ORIGIN
    # ...and nothing internal (hostnames, driver messages) leaks into it.
    assert "db.internal" not in response.text
    assert "pool" not in response.text


@pytest.mark.parametrize("exc", _OUTAGES, ids=["pool_timeout", "connection_refused"])
@pytest.mark.parametrize("method,path", _SESSION_ENDPOINTS)
def test_session_endpoint_reports_db_outage_as_503(monkeypatch, method, path, exc):
    monkeypatch.setattr(conv_mod, "_store", _DownStore(exc))
    client = TestClient(app, headers={CLIENT_HEADER: "test", "Origin": _VITE_ORIGIN})

    _assert_readable_503(client.request(method, path))


def test_missing_db_url_is_reported_as_503(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_DB_URL", None)
    monkeypatch.setattr(conv_mod, "_store", conv_mod._SupabaseSessionStore())
    client = TestClient(app, headers={"Origin": _VITE_ORIGIN})

    _assert_readable_503(client.get("/api/chat/sessions/s1"))


def test_news_db_outage_is_reported_as_503(monkeypatch):
    from backend.app.features.news import router as news_router

    def down(*_args, **_kwargs):
        raise psycopg_pool.PoolTimeout("pool initialization incomplete after 3.0 sec")

    monkeypatch.setattr(settings, "SUPABASE_DB_URL", "postgresql://configured")
    monkeypatch.setattr(news_router._store, "list_items", down)
    client = TestClient(app, headers={"Origin": _VITE_ORIGIN})

    _assert_readable_503(client.get("/api/news"))


def test_other_errors_are_not_disguised_as_outages(monkeypatch):
    # A bug must stay a 500 — mapping everything to 503 would hide it.
    monkeypatch.setattr(conv_mod, "_store", _DownStore(ValueError("a real bug")))
    client = TestClient(app, raise_server_exceptions=False)

    assert client.get("/api/chat/sessions/s1").status_code == 500
