import concurrent.futures
import datetime
import os
import threading
import uuid

import psycopg
import pytest

from backend.app.core.config import settings
from backend.app.shared.conversation_store import _DEFAULT_PROFILE_ID, _SupabaseSessionStore


def test_constructor_does_not_raise_or_connect_without_config(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_DB_URL", None)
    store = _SupabaseSessionStore()  # must not raise
    assert store._pool is None       # must not have connected either


def test_method_call_raises_clearly_when_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_DB_URL", None)
    store = _SupabaseSessionStore()
    with pytest.raises(RuntimeError, match="SUPABASE_DB_URL"):
        store.load("chat:x")


def test_close_before_any_use_does_not_raise(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_DB_URL", None)
    store = _SupabaseSessionStore()
    store.close()  # never opened a pool — must be a safe no-op


def _unique_key(prefix: str = "test") -> str:
    return f"{prefix}:{uuid.uuid4().hex}"


@pytest.fixture
def supabase_store(monkeypatch):
    db_url = os.environ["SUPABASE_TEST_DATABASE_URL"]
    monkeypatch.setattr(settings, "SUPABASE_DB_URL", db_url)
    store = _SupabaseSessionStore()
    yield store
    store.close()


@pytest.mark.supabase_integration
def test_load_on_unknown_key_returns_empty(supabase_store):
    assert supabase_store.load_with_revision(_unique_key()) == ([], 0)


@pytest.mark.supabase_integration
def test_save_then_load_round_trips_string_content(supabase_store):
    key = _unique_key()
    messages = [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}]
    supabase_store.save(key, messages)
    assert supabase_store.load(key) == messages


@pytest.mark.supabase_integration
def test_save_then_load_round_trips_dict_content(supabase_store):
    """Research stores dict content (event.get("data", {})), not just strings."""
    key = _unique_key()
    messages = [{"role": "assistant", "content": {"summary": "x", "confidence": 0.8}}]
    supabase_store.save(key, messages)
    assert supabase_store.load(key) == messages


@pytest.mark.supabase_integration
def test_save_increments_revision(supabase_store):
    key = _unique_key()
    supabase_store.save(key, [{"role": "user", "content": "a"}])
    _, rev1 = supabase_store.load_with_revision(key)
    supabase_store.save(key, [{"role": "user", "content": "a"}, {"role": "assistant", "content": "b"}])
    _, rev2 = supabase_store.load_with_revision(key)
    assert rev1 == 1
    assert rev2 == 2


@pytest.mark.supabase_integration
def test_messages_ordered_by_insertion(supabase_store):
    key = _unique_key()
    messages = [{"role": "user", "content": str(i)} for i in range(5)]
    supabase_store.save(key, messages)
    assert supabase_store.load(key) == messages


@pytest.mark.supabase_integration
def test_delete_removes_session_and_cascades_messages(supabase_store):
    key = _unique_key()
    supabase_store.save(key, [{"role": "user", "content": "a"}])
    supabase_store.delete(key)
    assert supabase_store.load_with_revision(key) == ([], 0)


@pytest.mark.supabase_integration
def test_unique_user_id_client_key_constraint_is_enforced(supabase_store):
    # save() itself upserts (on conflict do nothing), so it never raises on
    # a duplicate -- this test exercises the constraint directly, against
    # the raw pool, to prove it actually exists in the schema.
    key = _unique_key()
    pool = supabase_store._get_pool()
    with pool.connection() as conn:
        conn.execute(
            "insert into sessions (user_id, client_key) values (%s, %s)",
            (_DEFAULT_PROFILE_ID, key),
        )
    with pytest.raises(psycopg.errors.UniqueViolation):
        with pool.connection() as conn:
            conn.execute(
                "insert into sessions (user_id, client_key) values (%s, %s)",
                (_DEFAULT_PROFILE_ID, key),
            )


@pytest.mark.supabase_integration
def test_cleanup_old_deletes_only_old_sessions(supabase_store):
    old_key = _unique_key("old")
    new_key = _unique_key("new")
    supabase_store.save(old_key, [{"role": "user", "content": "a"}])
    supabase_store.save(new_key, [{"role": "user", "content": "b"}])

    pool = supabase_store._get_pool()
    old_timestamp = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=60)
    with pool.connection() as conn:
        conn.execute(
            "update sessions set updated_at = %s where client_key = %s",
            (old_timestamp, old_key),
        )

    deleted = supabase_store.cleanup_old(max_age_days=30)

    assert deleted >= 1
    assert supabase_store.load_with_revision(old_key) == ([], 0)
    assert supabase_store.load(new_key) == [{"role": "user", "content": "b"}]


@pytest.mark.supabase_integration
def test_save_rolls_back_atomically_on_constraint_violation(supabase_store):
    """The reason for a direct transactional connection instead of
    supabase-py: an insert failing partway through save() must not leave
    the session half-deleted, half-inserted."""
    key = _unique_key()
    original = [{"role": "user", "content": "original message"}]
    supabase_store.save(key, original)
    _, original_revision = supabase_store.load_with_revision(key)

    bad_messages = [{"role": "not_a_valid_role", "content": "x"}]
    with pytest.raises(psycopg.errors.CheckViolation):
        supabase_store.save(key, bad_messages)

    messages_after, revision_after = supabase_store.load_with_revision(key)
    assert messages_after == original
    assert revision_after == original_revision


@pytest.mark.supabase_integration
def test_save_empty_list_keeps_session_with_zero_messages(supabase_store):
    key = _unique_key()
    supabase_store.save(key, [])
    assert supabase_store.load_with_revision(key) == ([], 1)


@pytest.mark.supabase_integration
def test_get_pool_is_thread_safe_and_returns_same_pool(monkeypatch, supabase_store):
    """Concurrent first-use callers must all observe the same pool instance —
    the check-and-create in _get_pool() is guarded by a lock so two threads
    racing on first use can't each construct (and orphan) their own pool.

    Counting ConnectionPool() constructor calls is the real discriminator:
    `_get_pool()` always returns `self._pool` freshly at the end, so even an
    unguarded race tends to leave every caller looking at the same final
    (last-written) pool object — identity alone doesn't reliably catch the
    bug. What the lock actually prevents is the constructor running more
    than once. A real ConnectionPool()+.open() is slow enough on its own
    that a race is unlikely to show up by chance, so this widens the window
    with a small artificial delay between the `self._pool is None` check and
    the assignment — exactly the gap the lock has to close."""
    import time

    import backend.app.shared.conversation_store as conv_mod

    real_pool_cls = conv_mod.ConnectionPool
    construct_count = 0
    count_lock = threading.Lock()

    def _slow_pool(*args, **kwargs):
        nonlocal construct_count
        with count_lock:
            construct_count += 1
        time.sleep(0.05)
        return real_pool_cls(*args, **kwargs)

    monkeypatch.setattr(conv_mod, "ConnectionPool", _slow_pool)

    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        pools = list(pool.map(lambda _: supabase_store._get_pool(), range(16)))

    first = pools[0]
    assert all(p is first for p in pools)
    assert construct_count == 1
