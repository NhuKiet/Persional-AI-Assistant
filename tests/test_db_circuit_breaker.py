"""While the database is down, fail fast instead of making every request wait
out the pool's 3 s open / 5 s connect timeouts (measured: 3.3 s per history
call, 5–11 s per news call, before each 503).
"""
import time

import psycopg
import psycopg.errors
import pytest

from backend.app.shared.db_health import DbCircuitBreaker, StorageUnavailableError

COOLDOWN = 15.0


@pytest.fixture
def clock():
    return {"now": 1000.0}


@pytest.fixture
def breaker(clock):
    return DbCircuitBreaker(cooldown=COOLDOWN, clock=lambda: clock["now"])


def _outage(breaker):
    with pytest.raises(psycopg.OperationalError):
        with breaker.guard():
            raise psycopg.OperationalError("connection refused")


def _runs(breaker) -> bool:
    ran = []
    with breaker.guard():
        ran.append(True)
    return bool(ran)


def test_healthy_database_passes_through(breaker):
    assert _runs(breaker)


def test_after_an_outage_calls_fail_at_once_without_touching_the_database(breaker):
    _outage(breaker)

    touched = []
    with pytest.raises(StorageUnavailableError):
        with breaker.guard():
            touched.append(True)
    assert touched == []


def test_after_the_cooldown_one_request_probes_while_others_still_fail_fast(breaker, clock):
    _outage(breaker)
    clock["now"] += COOLDOWN + 0.1

    with breaker.guard():  # the probe gets through...
        with pytest.raises(StorageUnavailableError):  # ...everyone else waits for its verdict
            with breaker.guard():
                pass

    assert _runs(breaker)  # the probe succeeded: healthy again


def test_a_failed_probe_starts_a_new_cooldown(breaker, clock):
    _outage(breaker)
    clock["now"] += COOLDOWN + 0.1
    _outage(breaker)  # the probe itself fails

    clock["now"] += COOLDOWN - 1
    with pytest.raises(StorageUnavailableError):
        with breaker.guard():
            pass


@pytest.mark.parametrize("error", [
    psycopg.IntegrityError("duplicate key"),
    psycopg.errors.QueryCanceled("statement timeout"),
    ValueError("bug in our code"),
])
def test_errors_from_a_reachable_database_do_not_trip_it(breaker, error):
    with pytest.raises(type(error)):
        with breaker.guard():
            raise error

    assert _runs(breaker)


def test_the_retry_hint_counts_down(breaker, clock):
    _outage(breaker)
    clock["now"] += 10

    with pytest.raises(StorageUnavailableError, match="5 giây"):
        with breaker.guard():
            pass


# ── the real stores, against a port nothing listens on ─────────────────


@pytest.fixture
def dead_database(monkeypatch):
    from backend.app.core.config import settings
    from backend.app.shared import db_health

    monkeypatch.setattr(settings, "SUPABASE_DB_URL", "postgresql://u:p@127.0.0.1:1/db")
    db_health.database.reset()
    yield
    db_health.database.reset()


def test_second_history_call_fails_fast_and_so_does_news(dead_database):
    from backend.app.features.news.store import _SupabaseNewsStore
    from backend.app.shared.conversation_store import _SupabaseSessionStore

    sessions = _SupabaseSessionStore()
    with pytest.raises(psycopg.OperationalError):
        sessions.load("chat:s1")  # pays the pool's open timeout once

    started = time.perf_counter()
    with pytest.raises(StorageUnavailableError):
        sessions.load("chat:s1")
    with pytest.raises(StorageUnavailableError):
        _SupabaseNewsStore().existing_urls(["https://example.com/a"])  # same database
    assert time.perf_counter() - started < 0.2


def test_old_import_path_still_names_the_same_error():
    from backend.app.shared import conversation_store

    assert conversation_store.StorageUnavailableError is StorageUnavailableError
