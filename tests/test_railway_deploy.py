"""The Railway deploy (deploy/railway/): one container with nginx in front of
uvicorn, built without the packages only the switched-off models need.

Two things can drift without anyone noticing until a deploy breaks:
- the app starting to import one of the pruned packages at startup;
- the Railway nginx config falling behind frontend/nginx.conf (the
  docker-compose deploy) on headers, CSP or proxy settings.
"""
import importlib.metadata
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
DOCKERFILE = REPO / "deploy" / "railway" / "Dockerfile"
TEMPLATE = REPO / "deploy" / "railway" / "nginx.conf.template"
START = REPO / "deploy" / "railway" / "start.sh"
COMPOSE_NGINX = REPO / "frontend" / "nginx.conf"


def _normalize(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def _exported(prunes: list[str]) -> set[str]:
    args = ["uv", "export", "--frozen", "--no-dev", "--no-emit-project", "--no-hashes"]
    for name in prunes:
        args += ["--prune", name]
    out = subprocess.run(args, cwd=REPO, capture_output=True, text=True, check=True).stdout
    return {_normalize(m.group(1)) for m in re.finditer(r"^([A-Za-z0-9][A-Za-z0-9._-]*)==", out, re.M)}


def _pruned_modules() -> list[str]:
    """Top-level modules of every distribution the Railway image leaves out."""
    if shutil.which("uv") is None:
        pytest.skip("uv is not installed")
    prunes = re.findall(r"--prune (\S+)", DOCKERFILE.read_text(encoding="utf-8"))
    assert prunes, "the Dockerfile no longer prunes anything — update this test"
    dropped = _exported([]) - _exported(prunes)
    assert {"torch", "transformers", "flagembedding"} <= dropped
    modules = []
    for module, dists in importlib.metadata.packages_distributions().items():
        if dists and all(_normalize(d) in dropped for d in dists) and not module.startswith("_"):
            modules.append(module)
    return sorted(modules)


_BOOT = r"""
import importlib.abc, json, os, sys

blocked = set(json.loads(os.environ["BLOCKED_MODULES"]))

class Block(importlib.abc.MetaPathFinder):
    def find_spec(self, name, path=None, target=None):
        if name.split(".")[0] in blocked:
            raise ModuleNotFoundError(f"{name} is not in the Railway image", name=name)
        return None

sys.meta_path.insert(0, Block())

from fastapi.testclient import TestClient
from main import app
import backend.app.core.lifespan as lifespan

with TestClient(app) as client:
    lifespan._seed_capabilities()  # the probe the boot thread runs, in the foreground
    health = client.get("/health")
    caps = client.get("/health/capabilities").json()["capabilities"]
    models = client.get("/api/models").json()
    hmer = client.get("/api/hmer/status").json()

leaked = sorted(name for name in sys.modules if name.split(".")[0] in blocked)
print(json.dumps({
    "health": health.status_code,
    "reranker": caps["reranker"]["status"],
    "hmer": caps["hmer"]["status"],
    "providers": sorted({m["provider"] for m in models["models"]}),
    "hmer_configured": hmer["configured"],
    "leaked": leaked,
}))
"""


def test_the_app_starts_without_the_packages_the_railway_image_leaves_out():
    modules = _pruned_modules()
    env = {
        **os.environ,
        "BLOCKED_MODULES": json.dumps(modules),
        # Empty values override .env: no billed probe, no live services.
        "OPENAI_API_KEY": "", "ANTHROPIC_API_KEY": "", "COHERE_API_KEY": "",
        "WEAVIATE_URL": "", "WEAVIATE_API_KEY": "", "SUPABASE_DB_URL": "",
        "HMER_CHECKPOINT": "", "OLLAMA_URL": "", "DEFAULT_PROVIDER": "openai",
        "RERANK_ENABLED": "false", "NEWS_ENABLED": "false",
        "PYTHONIOENCODING": "utf-8",
    }
    done = subprocess.run(
        [sys.executable, "-c", _BOOT], cwd=REPO, env=env, capture_output=True, text=True, timeout=300,
    )
    assert done.returncode == 0, done.stderr[-3000:]
    result = json.loads(done.stdout.strip().splitlines()[-1])

    assert result["health"] == 200
    assert result["leaked"] == []
    assert result["reranker"] == "disabled"
    assert result["hmer"] == "disabled"
    assert result["hmer_configured"] is False
    assert "ollama" not in result["providers"]


# ── nginx: the Railway config keeps what the compose config guarantees ──────

def _csp(text: str) -> str:
    return re.search(r'add_header Content-Security-Policy "([^"]+)" always;', text).group(1)


def _directive(text: str, name: str) -> list[str]:
    return [m.strip() for m in re.findall(rf"^\s*{name}\s+([^;]+);", text, re.M)]


def test_the_railway_nginx_config_keeps_the_same_policy_as_the_compose_one():
    railway, compose = TEMPLATE.read_text(encoding="utf-8"), COMPOSE_NGINX.read_text(encoding="utf-8")

    assert _csp(railway) == _csp(compose)
    for name in ("gzip_types", "client_max_body_size", "proxy_read_timeout", "proxy_buffering", "expires", "server_tokens"):
        assert _directive(railway, name) == _directive(compose, name), name
    # Every location sends the shared security headers, HSTS included.
    assert railway.count("include /etc/nginx/snippets/security-headers.conf;") == railway.count("location ")
    assert "application/javascript mjs;" in railway


def test_the_visitor_address_comes_from_the_edge_and_cannot_be_forged():
    railway = TEMPLATE.read_text(encoding="utf-8")

    assert "real_ip_header X-Real-IP;" in railway
    # Overwritten, never appended: a browser-sent X-Forwarded-For is dropped.
    assert "proxy_set_header X-Forwarded-For $remote_addr;" in railway
    assert "$proxy_add_x_forwarded_for" not in railway


def test_start_script_migrates_first_and_runs_one_worker_behind_local_nginx():
    script = START.read_text(encoding="utf-8")

    assert script.index("python tools/migrate.py") < script.index("uvicorn main:app")
    assert "--workers" not in script
    assert "--forwarded-allow-ips 127.0.0.1" in script
    assert "--host 127.0.0.1" in script
    assert "\r" not in script


def _find_bash() -> str | None:
    for candidate in (
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files\Git\usr\bin\bash.exe",
    ):
        if os.path.exists(candidate):
            return candidate
    found = shutil.which("bash")
    if found and "system32" not in found.lower():
        return found
    return None


@pytest.mark.skipif(_find_bash() is None, reason="no bash that inherits the environment is installed")
@pytest.mark.parametrize(("given", "expected"), [
    ("king.up.railway.app", "localhost,king.up.railway.app"),
    ("localhost,king.up.railway.app", "localhost,king.up.railway.app"),
    ("", "localhost"),
])
def test_the_health_check_host_stays_allowed_whatever_the_service_sets(given, expected):
    # nginx asks for /health as "localhost"; refusing it fails Railway's check.
    script = START.read_text(encoding="utf-8")
    block = script[script.index('case ",${ALLOWED_HOSTS'):script.index("esac") + 4]
    bash = _find_bash()
    assert bash is not None
    done = subprocess.run(
        [bash, "-c", f'{block}\nprintf %s "$ALLOWED_HOSTS"'],
        env={**os.environ, "ALLOWED_HOSTS": given}, capture_output=True, text=True,
    )
    assert done.stdout == expected


def test_everything_the_image_copies_exists():
    for source in re.findall(r"^COPY (?!--from)(\S+)", DOCKERFILE.read_text(encoding="utf-8"), re.M):
        assert list(REPO.glob(source.rstrip("/"))), source
