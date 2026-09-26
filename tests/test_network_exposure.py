"""The API has no auth yet, so what keeps it private is where it listens and
which Host headers it answers. These tests pin both.

- Host allowlist (TrustedHostMiddleware): DNS rebinding points evil.com at
  127.0.0.1, making every API call same-origin for the browser — but the
  browser still sends `Host: evil.com`, which must be refused.
- docker-compose publishes ports on loopback only: a bare "8000:8000" binds
  0.0.0.0, reachable from the LAN and past host firewalls such as ufw.
"""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.core.config import Settings
from main import app

_ROOT = Path(__file__).resolve().parents[1]


# ── Host allowlist ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("base_url", ["http://evil.example", "http://192.168.1.20:8000"])
def test_request_with_foreign_host_header_is_refused(base_url):
    response = TestClient(app, base_url=base_url).get("/health")
    assert response.status_code == 400


@pytest.mark.parametrize("base_url", ["http://localhost:8000", "http://127.0.0.1:8000"])
def test_request_to_loopback_host_is_served(base_url):
    response = TestClient(app, base_url=base_url).get("/health")
    assert response.status_code == 200


def test_foreign_host_is_refused_before_reaching_state_changing_routes():
    response = TestClient(app, base_url="http://evil.example").delete(
        "/api/chat/session/some-session"
    )
    assert response.status_code == 400


def test_default_allowed_hosts_are_loopback_only(monkeypatch):
    monkeypatch.delenv("ALLOWED_HOSTS", raising=False)
    assert Settings(_env_file=None).allowed_hosts == ["localhost", "127.0.0.1"]


def test_allowed_hosts_parses_comma_separated_list(monkeypatch):
    monkeypatch.setenv("ALLOWED_HOSTS", " king.example.com , *.lan.example ,localhost")
    assert Settings(_env_file=None).allowed_hosts == [
        "king.example.com", "*.lan.example", "localhost",
    ]


@pytest.mark.parametrize("bad", ["", " , ", "*.", "api.*.example.com"])
def test_invalid_allowed_hosts_fail_at_startup(monkeypatch, bad):
    monkeypatch.setenv("ALLOWED_HOSTS", bad)
    with pytest.raises(ValueError):
        Settings(_env_file=None)


# ── docker-compose port publishing ──────────────────────────────────────────

def _published_ports():
    yaml = pytest.importorskip("yaml")
    compose = yaml.safe_load((_ROOT / "docker-compose.yml").read_text(encoding="utf-8"))
    return [
        (name, str(port))
        for name, service in compose["services"].items()
        for port in service.get("ports", [])
    ]


def test_compose_publishes_ports():
    assert _published_ports(), "expected backend/frontend to publish ports"


def test_compose_binds_every_published_port_to_loopback():
    exposed = [(name, port) for name, port in _published_ports()
               if not port.startswith("127.0.0.1:")]
    assert not exposed, f"ports reachable from the network: {exposed}"
