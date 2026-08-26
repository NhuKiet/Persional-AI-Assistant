"""What actually happened to the dependencies we otherwise cannot see fail.

The research feature holds 32 non-fatal degradation points — try/except blocks
that log a warning and continue. Each is individually right: a run must not die
because one source timed out. Together they mean every failure mode looks
identical to healthy operation from outside the process.

The clearest case: the BGE reranker was unable to score for an unknown length
of time while every startup signal reported success, because the model *loaded*
and only `compute_score` raised — an exception its caller swallowed into "fall
back to credibility". The main ranking signal of the feature was dead and
nothing in the system could say so.

This records the outcome of REAL calls rather than synthetic probes. Every
outage found in August 2026 was visible only when real data went through: a
probe embedding of "healthcheck" succeeds while a real batch of 32 chunks
fails on a rate limit, and a reranker loads fine while being unable to score.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass

LLM = "llm"
EMBEDDINGS = "embeddings"
KNOWLEDGE_STORE = "knowledge_store"
RERANKER = "reranker"

CAPABILITIES = (LLM, EMBEDDINGS, KNOWLEDGE_STORE, RERANKER)

OK = "ok"
DEGRADED = "degraded"
DISABLED = "disabled"
UNKNOWN = "unknown"

_MAX_ERROR_CHARS = 200


@dataclass
class _State:
    status: str = UNKNOWN
    consecutive_failures: int = 0
    total_ok: int = 0
    total_failed: int = 0
    last_error: str = ""
    last_error_at: float | None = None
    last_ok_at: float | None = None


_lock = threading.Lock()
_states: dict[str, _State] = {name: _State() for name in CAPABILITIES}


def ok(capability: str) -> None:
    """A real call to this dependency succeeded."""
    with _lock:
        s = _states[capability]
        s.status = OK
        s.consecutive_failures = 0
        s.total_ok += 1
        s.last_ok_at = time.time()


def failed(capability: str, detail: str) -> None:
    """A real call to this dependency failed.

    A capability explicitly marked `disabled` keeps that status — the failure
    is still counted, but an operator who switched something off should not be
    told it is broken.
    """
    with _lock:
        s = _states[capability]
        if s.status != DISABLED:
            s.status = DEGRADED
        s.consecutive_failures += 1
        s.total_failed += 1
        s.last_error = str(detail)[:_MAX_ERROR_CHARS]
        s.last_error_at = time.time()


def disabled(capability: str) -> None:
    """Switched off by configuration. Distinct from degraded on purpose:
    reporting a deliberately disabled capability as broken is worse than
    silence, because it teaches operators to dismiss warnings."""
    with _lock:
        _states[capability].status = DISABLED


def snapshot() -> dict:
    """Current state plus the aggregate. Computed here so both health
    endpoints read one rule rather than each deriving it."""
    with _lock:
        caps = {
            name: {
                "status": s.status,
                "consecutive_failures": s.consecutive_failures,
                "total_ok": s.total_ok,
                "total_failed": s.total_failed,
                "last_error": s.last_error,
                "last_error_at": s.last_error_at,
                "last_ok_at": s.last_ok_at,
            }
            for name, s in _states.items()
        }
    aggregate = DEGRADED if any(c["status"] == DEGRADED for c in caps.values()) else OK
    return {"status": aggregate, "capabilities": caps}


def reset() -> None:
    """Test hook. This registry is module-global, so without a reset between
    tests one test's reported failure leaks into another's assertions — and
    the leak would depend on test order, which is the worst kind."""
    with _lock:
        for name in CAPABILITIES:
            _states[name] = _State()
