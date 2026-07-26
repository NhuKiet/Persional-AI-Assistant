"""Compatibility imports for the shared conversation store."""

from backend.app.shared.conversation_store import (
    ConversationManager,
    _store,
)

__all__ = ["ConversationManager", "_store"]
