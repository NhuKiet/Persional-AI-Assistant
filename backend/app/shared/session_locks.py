"""Keyed per-session lock registry shared by streaming/mutating feature services.

Each feature service (chat, coding, pdf, research) owns its own
``KeyedLockRegistry`` instance and acquires a lock for the lifetime of a
session-mutating request (a streaming turn that appends to session history).
Reads (history GET) never acquire this lock.

SINGLE-WORKER LIMITATION: locks live in this process's memory only. Running
the backend with multiple worker processes (e.g. ``uvicorn --workers N`` or
multiple gunicorn workers) means each worker gets its own registry, so a
session could still be mutated concurrently from two different workers. This
app is designed to run as exactly one backend process; do not add
Redis/DB-backed distributed locking to fix this without revisiting that
assumption first.
"""

import hashlib
import itertools
import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

# Last-resort ceiling on how long one session can stay busy: longer than any
# stream's own timeout (research gives up after 30 min), so it only ever
# frees a session whose holder leaked — a bug, not a slow answer.
MAX_LEASE_SECONDS = 45 * 60


class SessionBusyError(Exception):
    """Raised when a session's lock is already held by another in-flight
    mutation/stream. Feature routers catch this and return HTTP 409."""

    def __init__(self, session_id: str):
        self.session_id = session_id
        super().__init__("session busy")


def sanitize_session_id(session_id: str) -> str:
    """Short, non-reversible fingerprint of a session id for audit logs.

    We never log raw session ids, prompts, or other user content — only this
    fingerprint plus a reason code (see ``log_concurrent_rejection``).
    """
    return hashlib.sha256(session_id.encode("utf-8", errors="replace")).hexdigest()[:12]


def log_concurrent_rejection(logger, feature: str, session_id: str) -> None:
    logger.warning(
        "session.concurrent_mutation_rejected feature=%s session=%s",
        feature,
        sanitize_session_id(session_id),
    )


class SessionLease:
    """One holder's share of a session's exclusive lock.

    The request that starts a stream gets the first share; a worker thread
    that may still write the session's history after the request is gone
    takes its own (``KeyedLockRegistry.share``). The session stays busy until
    every share is released. ``release()`` is idempotent, so the paths that
    end a stream can all call it without giving up someone else's share.
    """

    __slots__ = ("key", "_registry", "_generation", "_released")

    def __init__(self, registry: "KeyedLockRegistry", key: str, generation: int):
        self.key = key
        self._registry = registry
        self._generation = generation
        self._released = False

    def release(self) -> None:
        self._registry._release(self)


@dataclass
class _Held:
    generation: int
    holders: int
    since: float


class KeyedLockRegistry:
    """Per-key non-blocking leases. One backend process/worker only (see
    module docstring). Only held keys are stored, so the table doesn't grow
    with every session ever seen."""

    def __init__(self, max_age: float = MAX_LEASE_SECONDS, clock: Callable[[], float] = time.monotonic):
        self._max_age = max_age
        self._clock = clock
        self._held: dict[str, _Held] = {}
        self._map_lock = threading.Lock()
        self._generations = itertools.count(1)

    def __len__(self) -> int:
        return len(self._held)

    def try_acquire(self, key: str) -> Optional[SessionLease]:
        """Take the session without blocking; ``None`` if another stream holds it.

        A lease older than ``max_age`` is taken over (and logged): whoever
        held it leaked it. Its late ``release()`` then frees nothing.
        """
        with self._map_lock:
            now = self._clock()
            held = self._held.get(key)
            if held is not None:
                if now - held.since < self._max_age:
                    return None
                logger.warning(
                    "session.lease_expired session=%s held_s=%.0f", sanitize_session_id(key), now - held.since,
                )
            held = _Held(generation=next(self._generations), holders=1, since=now)
            self._held[key] = held
            return SessionLease(self, key, held.generation)

    def share(self, key: str) -> Optional[SessionLease]:
        """Another share of the lease on ``key`` — for work that may outlive
        the request, such as a worker thread that saves the answer. ``None``
        when nothing holds ``key`` (a service called directly, as in tests)."""
        with self._map_lock:
            held = self._held.get(key)
            if held is None:
                return None
            held.holders += 1
            return SessionLease(self, key, held.generation)

    def release(self, lease: SessionLease) -> None:
        lease.release()

    def _release(self, lease: SessionLease) -> None:
        with self._map_lock:
            if lease._released:
                return
            lease._released = True
            held = self._held.get(lease.key)
            if held is None or held.generation != lease._generation:
                return  # expired and taken over since — not ours to free
            held.holders -= 1
            if held.holders <= 0:
                del self._held[lease.key]
