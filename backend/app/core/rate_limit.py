"""Per-client rate limit for endpoints that spend money or GPU time.

Session locks only stop two streams on the same session id; a client that
rotates ids could fire paid LLM / search runs as fast as it liked. This caps
requests per client per minute, in two tiers:

- "research": one request fans out to several search APIs and LLM calls.
- "expensive": everything else that calls an LLM or the HMER model.

In-memory, so single-worker only — same constraint as session_locks.py.
"""
import math
import time
from collections import deque
from collections.abc import Callable

from fastapi import HTTPException, Request

from backend.app.core.config import settings

_WINDOW_SECONDS = 60.0

# tier -> Settings attribute holding its per-minute limit. Looked up on every
# request, so a changed setting (or a test's monkeypatch) applies at once.
_TIER_LIMITS = {
    "expensive": "RATE_LIMIT_PER_MINUTE",
    "research": "RATE_LIMIT_RESEARCH_PER_MINUTE",
}


class SlidingWindowLimiter:
    """Counts accepted hits per key over a sliding window. Refused hits are
    not recorded, so hammering while limited doesn't push the wait out."""

    _SWEEP_EVERY = 1024

    def __init__(self, window: float = _WINDOW_SECONDS, clock: Callable[[], float] = time.monotonic):
        self._window = window
        self._clock = clock
        self._hits: dict[tuple[str, str], deque[float]] = {}
        self._calls = 0

    def hit(self, key: tuple[str, str], limit: int) -> float:
        """Record a hit for `key`. Returns 0.0 if accepted, otherwise the
        seconds until the oldest counted hit leaves the window."""
        now = self._clock()
        self._calls += 1
        if self._calls % self._SWEEP_EVERY == 0:
            self._sweep(now)

        hits = self._hits.setdefault(key, deque())
        while hits and now - hits[0] >= self._window:
            hits.popleft()
        if len(hits) >= limit:
            return self._window - (now - hits[0]) if hits else self._window
        hits.append(now)
        return 0.0

    def reset(self) -> None:
        self._hits.clear()

    def _sweep(self, now: float) -> None:
        # One key per client IP and tier: drop the idle ones so the table
        # doesn't grow with every address ever seen.
        idle = [k for k, hits in self._hits.items() if not hits or now - hits[-1] >= self._window]
        for key in idle:
            del self._hits[key]


limiter = SlidingWindowLimiter()


def rate_limit(tier: str):
    """FastAPI dependency: `dependencies=[Depends(rate_limit("expensive"))]`.
    Raises 429 with Retry-After when the client is over its tier's limit."""
    limit_setting = _TIER_LIMITS[tier]  # unknown tier fails at import, not per request

    async def _check(request: Request) -> None:
        if not settings.RATE_LIMIT_ENABLED:
            return
        client = request.client.host if request.client else "unknown"
        wait = limiter.hit((client, tier), getattr(settings, limit_setting))
        if wait > 0:
            seconds = max(1, math.ceil(wait))
            raise HTTPException(
                status_code=429,
                detail=f"Gửi quá nhiều yêu cầu — thử lại sau {seconds} giây.",
                headers={"Retry-After": str(seconds)},
            )

    return _check
