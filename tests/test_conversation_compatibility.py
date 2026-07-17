"""Regression coverage for legacy conversation imports."""


def test_legacy_conversation_module_reexports_shared_store_symbols():
    import tools.conversation as legacy
    from backend.app.shared import conversation_store as shared

    assert legacy.ConversationManager is shared.ConversationManager
    assert legacy._SessionStore is shared._SessionStore
    assert legacy._store is shared._store
