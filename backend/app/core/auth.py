"""Owner login and the guest trial.

Two roles. The owner signs in with OWNER_PASSWORD and gets everything.
Everyone else is a guest, who may try a short list of tools (chat, PDF,
handwritten maths, research) a few times a day — see GUEST_ROUTES. The policy is
deny-by-default: a route not listed there needs the owner, so a feature added
later is never opened to guests by accident.

Without OWNER_PASSWORD the app runs open, as it always has — everyone is the
owner. config.py refuses that combination once ALLOWED_HOSTS reaches beyond
this machine.

The session is a signed, stateless cookie: "v1.<expiry>.<hmac>". HttpOnly (no
script can read it), SameSite=Strict (no other site can send it), and the
frontend talks to the backend on the same origin (src/lib/api.ts) so the
browser attaches it to every request, including ones it makes on its own
(react-pdf loading a file, an <img>).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import math
import re
import threading
import time
from collections import deque
from collections.abc import Callable

from starlette.requests import cookie_parser
from starlette.types import ASGIApp, Receive, Scope, Send

from backend.app.core.config import settings

logger = logging.getLogger(__name__)

OWNER = "owner"
GUEST = "guest"
COOKIE_NAME = "king_session"
GUEST_TOOLS = ["chat", "pdf", "hmer", "research"]

# The daily allowances a guest call can take from. Research has its own,
# smaller one: each run calls several search APIs and many LLM rounds.
TURN = "turn"
RESEARCH = "research"

_DAY = 24 * 3600

# Anyone, no quota.
PUBLIC_ROUTES: list[tuple[str, str]] = [
    ("GET", r"/health"),
    ("GET", r"/api/models"),
    ("GET", r"/api/auth/me"),
    ("POST", r"/api/auth/login"),
    ("POST", r"/api/auth/logout"),
]
# Guests too. The third column is the allowance each call spends (None = free).
GUEST_ROUTES: list[tuple[str, str, str | None]] = [
    ("POST", r"/api/chat/stream", TURN),
    ("POST", r"/api/pdf/upload", None),
    ("GET", r"/api/pdf/raw/[^/]+", None),
    ("DELETE", r"/api/pdf/file/[^/]+", None),
    ("POST", r"/api/pdf/stream", TURN),
    ("POST", r"/api/pdf/summarize", TURN),
    ("GET", r"/api/hmer/status", None),
    ("POST", r"/api/hmer/recognize", TURN),
    ("POST", r"/api/hmer/explain", None),
    ("GET", r"/api/research/trending", None),
    ("POST", r"/api/research/stream", RESEARCH),
    # One LLM answer about one source: priced like a chat turn.
    ("POST", r"/api/research/deep-dive", TURN),
]

_PUBLIC = [(m, re.compile(p)) for m, p in PUBLIC_ROUTES]
_GUEST = [(m, re.compile(p), quota) for m, p, quota in GUEST_ROUTES]


# ── password and session token ──────────────────────────────────────────


def _secret() -> bytes:
    if settings.SESSION_SECRET:
        return settings.SESSION_SECRET.encode()
    # Derived from the password: changing it signs every session out.
    return hashlib.sha256(b"king-session-v1:" + (settings.OWNER_PASSWORD or "").encode()).digest()


def _sign(payload: str) -> str:
    return hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest()


def check_password(candidate: str) -> bool:
    if not settings.OWNER_PASSWORD:
        return False
    return hmac.compare_digest(candidate.encode(), settings.OWNER_PASSWORD.encode())


def issue_token(now: float | None = None) -> str:
    expires = int((time.time() if now is None else now) + settings.SESSION_DAYS * _DAY)
    payload = f"v1.{expires}"
    return f"{payload}.{_sign(payload)}"


def verify_token(token: str | None, now: float | None = None) -> bool:
    try:
        version, expires, signature = (token or "").split(".")
        payload = f"{version}.{expires}"
        return (
            version == "v1"
            and hmac.compare_digest(signature, _sign(payload))
            and int(expires) > (time.time() if now is None else now)
        )
    except ValueError:
        return False


def role_for_cookie(cookie_header: str | None) -> str:
    if not settings.auth_enabled:
        return OWNER
    token = cookie_parser(cookie_header or "").get(COOKIE_NAME)
    return OWNER if verify_token(token) else GUEST


# ── guest quota ─────────────────────────────────────────────────────────


class GuestQuota:
    """`limit()` turns per client in any 24 hours. In memory, one backend
    process (same assumption as core/rate_limit.py). The limit is read on
    every call, so it follows the settings."""

    def __init__(self, limit: Callable[[], int], clock: Callable[[], float] = time.monotonic):
        self._limit = limit
        self._clock = clock
        self._lock = threading.Lock()
        self._turns: dict[str, deque[float]] = {}

    def reset(self) -> None:
        with self._lock:
            self._turns.clear()

    def _recent(self, client: str, now: float) -> deque[float]:
        turns = self._turns.get(client, deque())
        while turns and turns[0] <= now - _DAY:
            turns.popleft()
        if turns:
            self._turns[client] = turns
        else:
            self._turns.pop(client, None)
        return turns

    def remaining(self, client: str) -> int:
        with self._lock:
            return max(0, self._limit() - len(self._recent(client, self._clock())))

    def spend(self, client: str) -> float | None:
        """Take one turn; None if taken, else seconds until one frees up."""
        with self._lock:
            now = self._clock()
            turns = self._recent(client, now)
            if len(turns) >= self._limit():
                return max(1.0, turns[0] + _DAY - now)
            turns.append(now)
            self._turns[client] = turns
            return None


guest_quota = GuestQuota(lambda: settings.GUEST_DAILY_LIMIT)
guest_research_quota = GuestQuota(lambda: settings.GUEST_RESEARCH_DAILY_LIMIT)
QUOTAS = {TURN: guest_quota, RESEARCH: guest_research_quota}


def guest_tools() -> list[str]:
    """The tools a guest may try with the current settings."""
    if not settings.GUEST_ENABLED:
        return []
    return [t for t in GUEST_TOOLS if t != "research" or settings.GUEST_RESEARCH_DAILY_LIMIT > 0]


def client_of(scope: Scope) -> str:
    client = scope.get("client")
    return client[0] if client else "unknown"


# ── the policy ──────────────────────────────────────────────────────────


def _match(method: str, path: str) -> tuple[bool, bool, str | None]:
    """(public, guest_allowed, the allowance it spends)."""
    if any(m == method and p.fullmatch(path) for m, p in _PUBLIC):
        return True, True, None
    for m, p, quota in _GUEST:
        if m == method and p.fullmatch(path):
            if quota == RESEARCH and settings.GUEST_RESEARCH_DAILY_LIMIT == 0:
                return False, False, None
            return False, True, quota
    return False, False, None


async def _json(send: Send, status: int, body: dict, headers: list[tuple[bytes, bytes]] | None = None) -> None:
    raw = json.dumps(body, ensure_ascii=False).encode()
    await send({
        "type": "http.response.start",
        "status": status,
        "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(raw)).encode()), *(headers or [])],
    })
    await send({"type": "http.response.body", "body": raw})


class AccessPolicyMiddleware:
    """Decides owner or guest for every HTTP request, stores it in
    `request.state.role`, and refuses what a guest may not do."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers") or [])
        cookie = headers.get(b"cookie", b"").decode("latin-1")
        role = role_for_cookie(cookie)
        scope.setdefault("state", {})["role"] = role

        method = scope["method"]
        if role == OWNER or method == "OPTIONS":
            await self.app(scope, receive, send)
            return

        public, allowed, spends = _match(method, scope["path"])
        if public or (allowed and settings.GUEST_ENABLED and spends is None):
            await self.app(scope, receive, send)
            return
        if not (allowed and settings.GUEST_ENABLED):
            await _json(send, 401, {
                "detail": "login_required",
                "message": "Tính năng này cần đăng nhập.",
            })
            return
        wait = QUOTAS[spends].spend(client_of(scope))
        if wait is not None:
            hours = math.ceil(wait / 3600)
            what = "lượt Research" if spends == RESEARCH else "lượt dùng thử"
            await _json(send, 429, {
                "detail": "guest_quota_exceeded",
                "quota": spends,
                "message": f"Hết {what} hôm nay — thử lại sau khoảng {hours} giờ, hoặc đăng nhập.",
            }, headers=[(b"retry-after", str(math.ceil(wait)).encode())])
            return
        await self.app(scope, receive, send)


def guest_model() -> tuple[str, str]:
    """The (provider, model) every guest request runs on, whatever it asked
    for: GUEST_PROVIDER/GUEST_MODEL, else the server's default."""
    from backend.app.core.llm import _resolve_model

    provider = (settings.GUEST_PROVIDER or settings.DEFAULT_PROVIDER).lower()
    model = settings.GUEST_MODEL or (settings.DEFAULT_MODEL if provider == settings.DEFAULT_PROVIDER else None)
    return provider, _resolve_model(provider, model)


def role_of(request) -> str:
    """The role the middleware decided for this request (owner when it didn't
    run, as in unit tests that call a route directly)."""
    return getattr(request.state, "role", OWNER)


def is_guest(request) -> bool:
    return role_of(request) == GUEST
