"""In-memory test double for the session store — no SQLite, no Supabase, no
I/O. Implements the same five-method contract as the production store
(`backend.app.shared.conversation_store._SupabaseSessionStore`), so tests
can monkeypatch `_store` with this instead of standing up a real database.
"""
from copy import deepcopy


class FakeSessionStore:
    def __init__(self):
        self._data: dict[str, tuple[list[dict], int]] = {}

    def load(self, key: str) -> list[dict]:
        return self.load_with_revision(key)[0]

    def load_with_revision(self, key: str) -> tuple[list[dict], int]:
        messages, revision = self._data.get(key, ([], 0))
        return deepcopy(messages), revision

    def save(self, key: str, messages: list[dict]) -> None:
        _, revision = self._data.get(key, ([], 0))
        self._data[key] = (deepcopy(messages), revision + 1)

    def delete(self, key: str) -> None:
        self._data.pop(key, None)

    def cleanup_old(self, max_age_days: int = 30) -> int:
        # No test exercises real time-based cleanup against this fake today;
        # provided for interface completeness. Add real aging behavior here
        # if a test ever needs it.
        return 0
