import os

import pytest

from tests.fake_session_store import FakeSessionStore


@pytest.fixture(autouse=True)
def _default_session_store(monkeypatch):
    """Most tests never care about session persistence at all and don't
    monkeypatch `_store` themselves — under the old SQLite-backed store
    that was harmless, since it worked with zero config out of the box.
    The production store is now `_SupabaseSessionStore`, which raises
    unless `SUPABASE_DB_URL` is configured, so any test that incidentally
    exercises a `ConversationManager` codepath needs a safe default.
    Individual tests that explicitly `monkeypatch.setattr(conv_mod,
    "_store", ...)` simply override this afterwards, so this is a no-op for
    them. `tests/test_supabase_session_store.py` constructs
    `_SupabaseSessionStore` instances directly rather than going through the
    module-level `_store` singleton, so it is unaffected by this fixture.
    """
    import backend.app.shared.conversation_store as conv_mod

    monkeypatch.setattr(conv_mod, "_store", FakeSessionStore())


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "supabase_integration: requires a local Supabase Postgres (supabase start); "
        "auto-skipped unless SUPABASE_TEST_DATABASE_URL is set.",
    )


def pytest_collection_modifyitems(config, items):
    if os.environ.get("SUPABASE_TEST_DATABASE_URL"):
        return
    skip = pytest.mark.skip(reason="SUPABASE_TEST_DATABASE_URL not set — run `supabase start` and export it to run these")
    for item in items:
        if "supabase_integration" in item.keywords:
            item.add_marker(skip)


@pytest.fixture(autouse=True)
def _reset_capability_registry():
    """The capability registry is module-global. Without this, a test that
    reports a failure changes what a later test observes, and which later test
    depends on collection order."""
    from backend.app.core import capabilities

    capabilities.reset()
    yield
    capabilities.reset()
