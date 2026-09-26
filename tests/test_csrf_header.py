"""CSRF guard: every state-changing /api request must carry X-KiNg-Client.

A page on another site can make the browser send a "simple" cross-origin
request with no CORS preflight: a multipart form POST (uploads), or a
body-less POST such as /api/news/refresh, which starts a paid LLM run. The
page can't read the answer, but the side effect still happens. A custom
header takes a request out of the "simple" class: the browser must preflight
it first, and CORS only approves our own origins.
"""
import pytest
from fastapi.testclient import TestClient

from backend.app.core.csrf import CLIENT_HEADER
from main import app

_VITE_ORIGIN = "http://localhost:5173"


def _client(**headers):
    return TestClient(app, headers=headers)


@pytest.fixture(autouse=True)
def side_effects(monkeypatch):
    """Should the guard ever regress, these tests must not start a real
    news run or reset the owner's bridge session — record instead."""
    from backend.app.core.config import settings
    from backend.app.features.news import scheduler

    calls = []

    async def fake_refresh():
        calls.append("news_refresh")
        return {"added": 0}

    monkeypatch.setattr(scheduler, "refresh_news", fake_refresh)
    monkeypatch.setattr(scheduler, "seconds_since_last_refresh", lambda: float("inf"))
    # Port 9 (discard) refuses the connection: a leaked reset call ends in 503.
    monkeypatch.setattr(settings, "BRIDGE_URL", "http://127.0.0.1:9")
    return calls


@pytest.mark.parametrize("method,path", [
    ("post", "/api/news/refresh"),
    ("post", "/api/bubble/reset"),
    ("delete", "/api/chat/session/csrf-s1"),
    ("delete", "/api/pdf/file/x.pdf"),
])
def test_state_changing_request_without_header_is_refused(method, path, side_effects):
    response = getattr(_client(), method)(path)
    assert response.status_code == 403
    assert response.json() == {"detail": "missing_client_header"}
    assert side_effects == []


def test_empty_header_value_is_refused():
    response = _client(**{CLIENT_HEADER: ""}).delete("/api/chat/session/csrf-s1")
    assert response.status_code == 403


def test_cross_site_multipart_upload_is_refused_before_touching_disk():
    from backend.app.features.coding.service import _session_sandbox

    target = _session_sandbox("csrf-upload") / "csrf.csv"
    target.unlink(missing_ok=True)

    response = _client().post(
        "/api/coding/upload",
        files={"file": ("csrf.csv", b"a,b\n1,2\n", "text/csv")},
        data={"session_id": "csrf-upload"},
    )

    assert response.status_code == 403
    assert not target.exists()


def test_request_with_header_reaches_the_route():
    response = _client(**{CLIENT_HEADER: "web"}).delete("/api/chat/session/csrf-s1")
    assert response.status_code == 200
    assert response.json() == {"cleared": "csrf-s1"}


@pytest.mark.parametrize("path", ["/health", "/api/models"])
def test_safe_methods_need_no_header(path):
    assert _client().get(path).status_code == 200


def test_preflight_from_our_origin_allows_the_header():
    response = _client().options(
        "/api/coding/upload",
        headers={
            "Origin": _VITE_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": CLIENT_HEADER.lower(),
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == _VITE_ORIGIN


def test_preflight_from_foreign_origin_is_not_approved():
    response = _client().options(
        "/api/coding/upload",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": CLIENT_HEADER.lower(),
        },
    )
    assert "access-control-allow-origin" not in response.headers


def test_refusal_is_readable_by_our_frontend():
    # The 403 must carry CORS headers, or the browser hides it behind a
    # generic network error and the UI can't say what went wrong.
    response = _client(Origin=_VITE_ORIGIN).delete("/api/chat/session/csrf-s1")
    assert response.status_code == 403
    assert response.headers["access-control-allow-origin"] == _VITE_ORIGIN
