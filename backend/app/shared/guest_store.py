"""Conversation memory for guests: in this process only, never the database.

A guest's trial keeps its context within a conversation ("explain that
further" works), but nothing a guest types is stored: sessions expire after
TTL_SECONDS without use, the oldest are dropped past MAX_SESSIONS, and a
restart forgets them all. Same five-method contract as the Postgres store,
so ConversationManager(store=guest_sessions) works unchanged.
"""
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from copy import deepcopy

TTL_SECONDS = 2 * 3600
MAX_SESSIONS = 500


class EphemeralSessionStore:
    def __init__(self, ttl: float = TTL_SECONDS, max_sessions: int = MAX_SESSIONS,
                 clock: Callable[[], float] = time.monotonic):
        self._ttl = ttl
        self._max = max_sessions
        self._clock = clock
        self._lock = threading.Lock()
        # key -> (messages, revision, last used); oldest-used first.
        self._data: OrderedDict[str, tuple[list[dict], int, float]] = OrderedDict()

    def _expire(self, now: float) -> None:
        while self._data:
            key, (_, _, used) = next(iter(self._data.items()))
            if now - used < self._ttl and len(self._data) <= self._max:
                break
            del self._data[key]

    def load(self, key: str) -> list[dict]:
        return self.load_with_revision(key)[0]

    def load_with_revision(self, key: str) -> tuple[list[dict], int]:
        with self._lock:
            self._expire(self._clock())
            messages, revision, _ = self._data.get(key, ([], 0, 0.0))
            return deepcopy(messages), revision

    def save(self, key: str, messages: list[dict]) -> None:
        with self._lock:
            now = self._clock()
            _, revision, _ = self._data.pop(key, ([], 0, 0.0))
            self._data[key] = (deepcopy(messages), revision + 1, now)
            self._expire(now)

    def delete(self, key: str) -> None:
        with self._lock:
            self._data.pop(key, None)

    def cleanup_old(self, max_age_days: int = 30) -> int:
        with self._lock:
            before = len(self._data)
            self._expire(self._clock())
            return before - len(self._data)

    def close(self) -> None:
        pass


guest_sessions = EphemeralSessionStore()
