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
import threading


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


class KeyedLockRegistry:
    """Per-key non-blocking locks. One backend process/worker only (see module docstring)."""

    def __init__(self):
        self._locks: dict[str, threading.Lock] = {}
        self._map_lock = threading.Lock()

    def _get_lock(self, key: str) -> threading.Lock:
        with self._map_lock:
            lock = self._locks.get(key)
            if lock is None:
                lock = threading.Lock()
                self._locks[key] = lock
            return lock

    def try_acquire(self, key: str) -> threading.Lock | None:
        """Attempt to acquire the lock for ``key`` without blocking.

        Returns the held lock on success, or ``None`` if it's already held by
        another in-flight mutation.
        """
        lock = self._get_lock(key)
        return lock if lock.acquire(blocking=False) else None

    def release(self, lock: threading.Lock) -> None:
        lock.release()
