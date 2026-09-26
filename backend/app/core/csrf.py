"""CSRF guard for a cookie-less, auth-less API.

A page on another site can make the browser send a "simple" cross-origin
request without any CORS preflight — a multipart form POST (every upload
route) or a body-less POST (/api/news/refresh starts a paid LLM run). It
can't read the answer, but the side effect happens anyway.

Requiring a custom header on every state-changing /api request closes that:
a request carrying a non-standard header is never "simple", so the browser
preflights it first, and CORSMiddleware only approves our own origins.
The frontend adds the header in `apiFetch` (frontend/src/lib/api.ts).
"""
from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

CLIENT_HEADER = "X-KiNg-Client"

_UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


class RequireClientHeaderMiddleware:
    """Refuse POST/PUT/PATCH/DELETE under /api/ that lack `CLIENT_HEADER`.

    Pure ASGI rather than BaseHTTPMiddleware so SSE responses stream through
    untouched. Must sit inside CORSMiddleware: the 403 then carries CORS
    headers and the frontend can show why, instead of a bare network error.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] == "http"
            and scope["method"] in _UNSAFE_METHODS
            and scope["path"].startswith("/api/")
            and not Headers(scope=scope).get(CLIENT_HEADER)
        ):
            response = JSONResponse({"detail": "missing_client_header"}, status_code=403)
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)
