"""Running behind Cloudflare Tunnel (docker-compose.yml + frontend/nginx.conf).

Behind a tunnel every request reaches nginx from the tunnel container, so
without help every visitor looks like one client: one shared guest quota,
one shared rate limit. The visitor's real address therefore has to come from
a header — and a header is only worth believing from the one peer that
Cloudflare's edge feeds. These tests pin that trust down, as far as it can be
checked without starting anything.
"""
import ipaddress
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NGINX_CONF = (ROOT / "frontend" / "nginx.conf").read_text(encoding="utf-8")
HEADERS = (ROOT / "frontend" / "nginx-security-headers.conf").read_text(encoding="utf-8")
TUNNEL_SERVICES = ("tunnel", "tunnel-quick")


@pytest.fixture(scope="module")
def compose() -> dict:
    yaml = pytest.importorskip("yaml")
    return yaml.safe_load((ROOT / "docker-compose.yml").read_text(encoding="utf-8"))


def _trusted_peers() -> list[str]:
    return re.findall(r"^\s*set_real_ip_from\s+([^;]+);", NGINX_CONF, re.MULTILINE)


def _tunnel_address(compose: dict, service: str) -> str:
    return compose["services"][service]["networks"]["default"]["ipv4_address"]


def test_the_tunnel_is_opt_in_and_publishes_no_port(compose):
    for name in TUNNEL_SERVICES:
        service = compose["services"][name]
        assert service["profiles"] == [name]  # `docker compose up` alone never starts it
        assert "ports" not in service         # it dials out to Cloudflare; nothing listens


def test_nginx_believes_the_visitor_address_from_the_tunnel_container_only(compose):
    peers = _trusted_peers()

    assert len(peers) == 1
    assert "/" not in peers[0]  # one address, never a subnet the other containers share
    assert {_tunnel_address(compose, name) for name in TUNNEL_SERVICES} == set(peers)
    assert re.search(r"^\s*real_ip_header\s+CF-Connecting-IP;", NGINX_CONF, re.MULTILINE)


def test_no_other_container_can_be_handed_the_trusted_address(compose):
    network = compose["networks"]["default"]["ipam"]["config"][0]
    trusted = ipaddress.ip_address(_trusted_peers()[0])

    assert trusted in ipaddress.ip_network(network["subnet"])
    # Docker hands out addresses from ip_range; the tunnel's sits outside it.
    assert trusted not in ipaddress.ip_network(network["ip_range"])


def test_the_backend_still_gets_one_address_nginx_vouches_for():
    # Overwritten, not appended to: whatever a browser sends in this header is dropped.
    assert NGINX_CONF.count("proxy_set_header X-Forwarded-For $remote_addr;") == 1
    assert "$proxy_add_x_forwarded_for" not in re.sub(r"#.*", "", NGINX_CONF)


def test_https_is_believed_only_from_the_tunnel():
    scheme = re.search(r"map \$realip_remote_addr \$forwarded_proto \{(.*?)\}", NGINX_CONF, re.DOTALL).group(1)

    assert re.search(rf"^\s*{re.escape(_trusted_peers()[0])}\s+\$http_x_forwarded_proto;", scheme, re.MULTILINE)
    assert re.search(r"^\s*default\s+\$scheme;", scheme, re.MULTILINE)
    assert "proxy_set_header X-Forwarded-Proto $forwarded_proto;" in NGINX_CONF


def test_browsers_are_told_to_stay_on_https_only_when_they_came_over_it():
    hsts = re.search(r"map \$forwarded_proto \$hsts \{(.*?)\}", NGINX_CONF, re.DOTALL).group(1)

    assert re.search(r'^\s*https\s+"max-age=\d+";', hsts, re.MULTILINE)
    assert re.search(r'^\s*default\s+"";', hsts, re.MULTILINE)  # empty = header not sent
    assert "add_header Strict-Transport-Security $hsts always;" in HEADERS


def test_the_tunnel_token_comes_from_the_environment(compose):
    assert compose["services"]["tunnel"]["environment"]["TUNNEL_TOKEN"] == "${CLOUDFLARE_TUNNEL_TOKEN:-}"
    assert "eyJ" not in (ROOT / "docker-compose.yml").read_text(encoding="utf-8")  # no token pasted in
