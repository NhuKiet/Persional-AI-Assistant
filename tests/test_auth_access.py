"""Owner login + guest trial.

The owner signs in with OWNER_PASSWORD and gets everything. Anyone else is a
guest: a short allowlist (chat, PDF, handwritten maths) with a daily quota,
everything else refused — including routes added later, since the policy is
deny-by-default. Without OWNER_PASSWORD the app stays open, but only while it
is reachable from this machine alone.
"""
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.core import auth
from backend.app.core.config import Settings, settings
from backend.app.core.csrf import CLIENT_HEADER

PASSWORD = "mat-khau-thu-nghiem"


@pytest.fixture
def secured(monkeypatch):
    monkeypatch.setattr(settings, "OWNER_PASSWORD", PASSWORD)
    monkeypatch.setattr(settings, "SESSION_SECRET", None)
    monkeypatch.setattr(settings, "GUEST_ENABLED", True)
    monkeypatch.setattr(settings, "GUEST_DAILY_LIMIT", 3)
    auth.guest_quota.reset()
    yield
    auth.guest_quota.reset()


@pytest.fixture
def client():
    from main import app

    return TestClient(app, headers={CLIENT_HEADER: "test"})


def _login(client, password=PASSWORD):
    return client.post("/api/auth/login", json={"password": password})


# ── configuration ───────────────────────────────────────────────────────


def test_an_app_reachable_from_outside_must_have_a_password():
    with pytest.raises(ValidationError, match="OWNER_PASSWORD"):
        Settings(ALLOWED_HOSTS="kiet.example.com", OWNER_PASSWORD=None)

    Settings(ALLOWED_HOSTS="kiet.example.com", OWNER_PASSWORD="x" * 12, COOKIE_SECURE=True)
    Settings(ALLOWED_HOSTS="localhost,127.0.0.1", OWNER_PASSWORD=None)  # this machine only: fine


def test_an_app_reachable_from_outside_must_keep_its_login_on_https():
    # Without the Secure flag the browser sends the session cookie — and the
    # login form sends the password — over plain HTTP to anyone on the path.
    with pytest.raises(ValidationError, match="COOKIE_SECURE"):
        Settings(ALLOWED_HOSTS="kiet.example.com", OWNER_PASSWORD="x" * 12, COOKIE_SECURE=False)

    Settings(ALLOWED_HOSTS="kiet.example.com", OWNER_PASSWORD="x" * 12, COOKIE_SECURE=True)
    Settings(ALLOWED_HOSTS="localhost,127.0.0.1", OWNER_PASSWORD="x" * 12, COOKIE_SECURE=False)  # this machine only: fine


def test_a_short_password_is_refused():
    with pytest.raises(ValidationError, match="OWNER_PASSWORD"):
        Settings(OWNER_PASSWORD="123")


# ── session tokens ──────────────────────────────────────────────────────


def test_token_roundtrip_tamper_and_expiry(secured):
    token = auth.issue_token(now=1000.0)

    assert auth.verify_token(token, now=1001.0)
    assert not auth.verify_token(token[:-1] + ("0" if token[-1] != "0" else "1"), now=1001.0)
    assert not auth.verify_token(token, now=1000.0 + settings.SESSION_DAYS * 86400 + 1)
    assert not auth.verify_token("rác", now=1001.0)


def test_changing_the_password_signs_everyone_out(secured, monkeypatch):
    token = auth.issue_token(now=1000.0)

    monkeypatch.setattr(settings, "OWNER_PASSWORD", PASSWORD + "-moi")

    assert not auth.verify_token(token, now=1001.0)


# ── login / logout / me ─────────────────────────────────────────────────


def test_wrong_password_is_refused(secured, client):
    response = _login(client, "sai-roi")

    assert response.status_code == 401
    assert client.get("/api/auth/me").json()["role"] == "guest"


def test_login_sets_a_strict_http_only_cookie_and_logout_clears_it(secured, client):
    response = _login(client)

    assert response.status_code == 200
    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie and "path=/" in cookie
    assert client.get("/api/auth/me").json()["role"] == "owner"

    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").json()["role"] == "guest"


def test_login_attempts_are_rate_limited(secured, client, monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_LOGIN_PER_MINUTE", 5)

    codes = [_login(client, "doan-bua").status_code for _ in range(6)]

    assert codes[:5] == [401] * 5
    assert codes[5] == 429


def test_me_tells_a_guest_what_it_can_do(secured, client):
    me = client.get("/api/auth/me").json()

    assert me["role"] == "guest"
    assert me["auth"] is True
    assert me["guest"] == {"enabled": True, "limit": 3, "remaining": 3, "tools": ["chat", "pdf", "hmer"]}


# ── the policy ──────────────────────────────────────────────────────────


@pytest.mark.parametrize("method,path", [
    ("POST", "/api/research/stream"),
    ("POST", "/api/coding/stream"),
    ("POST", "/api/bubble/chat"),
    ("GET", "/api/pdf/list"),
    ("POST", "/api/pdf/suggestions"),
    ("GET", "/api/chat/sessions/abc"),
    ("GET", "/api/hmer/images"),
    ("GET", "/health/latency"),
    ("GET", "/docs"),
    ("GET", "/api/some-route-added-later"),
])
def test_guests_are_refused_everything_not_on_the_list(secured, client, method, path):
    response = client.request(method, path, json={} if method == "POST" else None)

    assert response.status_code == 401
    assert response.json()["detail"] == "login_required"


@pytest.mark.parametrize("path", ["/health", "/api/models", "/api/hmer/status", "/api/auth/me"])
def test_guests_can_reach_the_public_and_trial_routes(secured, client, path):
    assert client.get(path).status_code == 200


def test_the_owner_reaches_owner_only_routes(secured, client):
    _login(client)

    assert client.get("/health/latency").status_code == 200


def test_a_forged_cookie_is_just_a_guest(secured, client):
    client.cookies.set(auth.COOKIE_NAME, "v1.9999999999.deadbeef")

    assert client.get("/health/latency").status_code == 401


def test_guest_trial_turns_run_out_but_the_owner_has_no_quota(secured, client, monkeypatch):
    import backend.app.features.chat.router as chat_router

    async def fake_stream(req):
        yield {"type": "token", "content": "ok"}

    monkeypatch.setattr(chat_router._service, "stream", fake_stream)
    monkeypatch.setattr(chat_router._guest_service, "stream", fake_stream)
    body = {"message": "hi", "session_id": "g1"}

    codes = [client.post("/api/chat/stream", json=body).status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]
    refused = client.post("/api/chat/stream", json=body)
    assert refused.json()["detail"] == "guest_quota_exceeded"
    assert int(refused.headers["retry-after"]) > 0
    assert client.get("/api/auth/me").json()["guest"]["remaining"] == 0

    _login(client)
    assert client.post("/api/chat/stream", json=body).status_code == 200


def test_with_guests_disabled_only_the_public_routes_answer(secured, client, monkeypatch):
    monkeypatch.setattr(settings, "GUEST_ENABLED", False)

    assert client.get("/api/hmer/status").status_code == 401
    assert client.get("/health").status_code == 200
    assert client.get("/api/auth/me").json()["guest"]["enabled"] is False


def test_open_mode_without_a_password_keeps_everything_reachable(client, monkeypatch):
    monkeypatch.setattr(settings, "OWNER_PASSWORD", None)

    assert client.get("/api/auth/me").json() == {"role": "owner", "auth": False, "guest": None}
    assert client.get("/health/latency").status_code == 200
