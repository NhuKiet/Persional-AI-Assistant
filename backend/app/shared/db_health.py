"""Fail fast while the database is down.

Both Postgres-backed stores (session history, news) open their pool lazily
with a 3 s open timeout and a 5 s connect timeout. With the database down,
every request paid that wait again before its 503 — measured 3.3 s per
history call and 5–11 s per news call — and held a worker thread meanwhile.

`database` is one circuit breaker for the one database both stores use:
after a connection failure it answers StorageUnavailableError at once for
COOLDOWN seconds, then lets a single request through to test the
connection while the others keep failing fast. Errors from a database that
did answer (a constraint violation, a statement timeout, a bug of ours)
never trip it.
"""
import logging
import math
import threading
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager

from psycopg import OperationalError
from psycopg.errors import QueryCanceled

logger = logging.getLogger(__name__)

COOLDOWN_SECONDS = 15.0


class StorageUnavailableError(RuntimeError):
    """The history store could not be read or written (DB down, pool
    timeout). Raised by `ConversationManager.chat_stream` so callers can
    tell the user it was the database — not the LLM — that failed."""


class DbCircuitBreaker:
    def __init__(self, cooldown: float = COOLDOWN_SECONDS, clock: Callable[[], float] = time.monotonic):
        self._cooldown = cooldown
        self._clock = clock
        self._lock = threading.Lock()
        self._retry_at = 0.0  # 0 = healthy
        self._probing = False

    def reset(self) -> None:
        """Test hook: forget any outage."""
        with self._lock:
            self._retry_at = 0.0
            self._probing = False

    @contextmanager
    def guard(self) -> Iterator[None]:
        """Wrap one unit of database work (getting a connection and using it)."""
        self._admit()
        try:
            yield
        except QueryCanceled:
            self._recover()  # the database answered: it cancelled a slow statement
            raise
        except OperationalError as exc:
            self._trip(exc)
            raise
        except Exception:
            self._recover()  # a constraint violation, or a bug of ours — not an outage
            raise
        except BaseException:
            self._release()  # interrupted: no verdict either way
            raise
        else:
            self._recover()

    def _admit(self) -> None:
        with self._lock:
            if not self._retry_at:
                return
            wait = self._retry_at - self._clock()
            if wait > 0 or self._probing:
                raise StorageUnavailableError(
                    f"Database tạm thời không kết nối được — thử lại sau {max(1, math.ceil(wait))} giây."
                )
            self._probing = True  # this caller tests the connection

    def _trip(self, exc: BaseException) -> None:
        with self._lock:
            first = not self._retry_at
            self._retry_at = self._clock() + self._cooldown
            self._probing = False
        if first:
            logger.warning(
                "Database không kết nối được (%s) — trả lỗi ngay trong %.0fs rồi mới thử lại.",
                type(exc).__name__, self._cooldown,
            )

    def _recover(self) -> None:
        with self._lock:
            was_down = bool(self._retry_at)
            self._retry_at = 0.0
            self._probing = False
        if was_down:
            logger.info("Database kết nối lại được.")

    def _release(self) -> None:
        with self._lock:
            self._probing = False


database = DbCircuitBreaker()
