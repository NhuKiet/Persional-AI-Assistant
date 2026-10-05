"""The headers nginx puts on the app (frontend/nginx.conf), as far as they
can be checked without starting nginx.

These guard the mistakes that fail silently: nothing errors when a header
stops being sent or the page's policy is loosened — the browser just stops
enforcing it.
"""
import re
from pathlib import Path

FRONTEND = Path(__file__).resolve().parents[1] / "frontend"
NGINX_CONF = (FRONTEND / "nginx.conf").read_text(encoding="utf-8")
HEADERS = (FRONTEND / "nginx-security-headers.conf").read_text(encoding="utf-8")
INDEX_HTML = (FRONTEND / "index.html").read_text(encoding="utf-8")


def _locations() -> dict[str, str]:
    """Each `location` of the server block, by its matcher."""
    return {
        match.group(1).strip(): match.group(2)
        for match in re.finditer(r"location\s+([^{]+)\{(.*?)\n    \}", NGINX_CONF, re.DOTALL)
    }


def _content_security_policy() -> dict[str, list[str]]:
    policy = re.search(r'add_header Content-Security-Policy "([^"]+)"', NGINX_CONF).group(1)
    directives = (part.split() for part in policy.split(";") if part.strip())
    return {name: values for name, *values in directives}


def test_every_location_sends_the_security_headers():
    # nginx drops the add_header lines inherited from the server block as
    # soon as a location has one of its own — so each location includes them.
    locations = _locations()

    assert set(locations) == {"/", "/api/", "= /health", "/assets/"}
    for matcher, body in locations.items():
        assert "include /etc/nginx/snippets/security-headers.conf;" in body, matcher


def test_the_shared_headers_cover_sniffing_framing_and_referrers():
    for header in ("X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy"):
        assert re.search(rf"add_header {header} \"[^\"]+\" always;", HEADERS), header


def test_the_page_may_only_run_scripts_from_its_own_origin():
    policy = _content_security_policy()

    assert policy["script-src"] == ["'self'"]  # no 'unsafe-inline', no 'unsafe-eval', no other host
    assert policy["default-src"] == ["'self'"]
    assert policy["object-src"] == ["'none'"]
    assert policy["frame-ancestors"] == ["'none'"]


def test_the_page_may_reach_only_the_three_outside_hosts_the_interface_uses():
    # Fonts are @import-ed from Google Fonts (styles/base.css, news.css); the
    # weather widget calls Open-Meteo (hooks/useTimeAndWeather.ts).
    policy = _content_security_policy()
    elsewhere = {value for values in policy.values() for value in values if "://" in value}

    assert elsewhere == {"https://fonts.googleapis.com", "https://fonts.gstatic.com", "https://api.open-meteo.com"}
    assert policy["style-src"] == ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"]
    assert policy["font-src"] == ["'self'", "data:", "https://fonts.gstatic.com"]
    assert policy["connect-src"] == ["'self'", "https://api.open-meteo.com"]


def test_the_app_keeps_the_device_features_it_uses():
    policy = re.search(r'add_header Permissions-Policy "([^"]+)"', HEADERS).group(1)

    assert "microphone=(self)" in policy   # MicButton
    assert "geolocation=(self)" in policy  # weather widget
    assert "camera=()" in policy


def test_index_html_has_no_inline_script_for_that_policy_to_block():
    scripts = re.findall(r"<script\b([^>]*)>(.*?)</script>", INDEX_HTML, re.DOTALL)

    assert scripts
    for attributes, body in scripts:
        assert "src=" in attributes and not body.strip()


def test_streams_are_not_compressed_or_buffered():
    # gzip would hold tokens back until a block fills up.
    assert "text/event-stream" not in re.search(r"gzip_types ([^;]+);", NGINX_CONF).group(1)
    assert "proxy_buffering off;" in _locations()["/api/"]
