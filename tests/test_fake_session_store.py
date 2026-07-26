from tests.fake_session_store import FakeSessionStore


def test_load_on_unknown_key_returns_empty():
    store = FakeSessionStore()
    assert store.load("chat:unknown") == []


def test_load_with_revision_on_unknown_key_returns_zero():
    store = FakeSessionStore()
    assert store.load_with_revision("chat:unknown") == ([], 0)


def test_save_then_load_round_trips():
    store = FakeSessionStore()
    messages = [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}]
    store.save("chat:s1", messages)
    assert store.load("chat:s1") == messages


def test_save_increments_revision_each_call():
    store = FakeSessionStore()
    store.save("chat:s1", [{"role": "user", "content": "a"}])
    _, rev1 = store.load_with_revision("chat:s1")
    store.save("chat:s1", [{"role": "user", "content": "a"}, {"role": "assistant", "content": "b"}])
    _, rev2 = store.load_with_revision("chat:s1")
    assert rev1 == 1
    assert rev2 == 2


def test_save_accepts_dict_content():
    """Research stores dict content (event.get("data", {})), not just strings."""
    store = FakeSessionStore()
    store.save("research:s1", [{"role": "assistant", "content": {"summary": "x", "confidence": 0.8}}])
    loaded = store.load("research:s1")
    assert loaded[0]["content"] == {"summary": "x", "confidence": 0.8}


def test_load_returns_a_deep_copy_not_a_shared_reference():
    """Mutating what load() returns must not silently corrupt the fake's
    stored state without going through save() — SQLite/Postgres can't
    exhibit that aliasing bug (both round-trip through serialization),
    so the fake must not either."""
    store = FakeSessionStore()
    store.save("chat:s1", [{"role": "user", "content": "original"}])

    loaded = store.load("chat:s1")
    loaded[0]["content"] = "mutated"

    assert store.load("chat:s1")[0]["content"] == "original"


def test_save_does_not_alias_the_caller_supplied_list():
    """The same protection in the other direction: mutating the list/dicts
    the caller passed to save() after the call must not affect what's stored."""
    store = FakeSessionStore()
    messages = [{"role": "user", "content": "original"}]
    store.save("chat:s1", messages)

    messages[0]["content"] = "mutated"

    assert store.load("chat:s1")[0]["content"] == "original"


def test_delete_removes_the_session():
    store = FakeSessionStore()
    store.save("chat:s1", [{"role": "user", "content": "a"}])
    store.delete("chat:s1")
    assert store.load_with_revision("chat:s1") == ([], 0)


def test_delete_on_unknown_key_does_not_raise():
    store = FakeSessionStore()
    store.delete("chat:unknown")  # no assertion needed — just must not raise
