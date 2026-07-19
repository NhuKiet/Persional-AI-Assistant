import json
import logging
import sqlite3
import threading
from pathlib import Path
from typing import AsyncGenerator

from backend.app.core.config import settings
from backend.app.core.llm import astream_chat


logger = logging.getLogger(__name__)

MAX_HISTORY = settings.MAX_HISTORY

_BASE_DIR = Path(__file__).resolve().parents[3]
_DB_PATH = _BASE_DIR / "data" / "sessions.db"


class _SessionStore:
    def __init__(self, db_path: Path = _DB_PATH):
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._db = str(db_path)
        self._lock = threading.Lock()
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    key        TEXT PRIMARY KEY,
                    messages   TEXT NOT NULL DEFAULT '[]',
                    updated_at REAL NOT NULL,
                    revision   INTEGER NOT NULL DEFAULT 0
                )
                """
            )
            try:
                conn.execute(
                    "ALTER TABLE sessions ADD COLUMN revision INTEGER NOT NULL DEFAULT 0"
                )
            except sqlite3.OperationalError:
                pass  # column already exists (fresh table already has it above)
            conn.commit()

    def load(self, key: str) -> list[dict]:
        return self.load_with_revision(key)[0]

    def load_with_revision(self, key: str) -> tuple[list[dict], int]:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT messages, revision FROM sessions WHERE key = ?", (key,)
            ).fetchone()
            if row is None:
                return [], 0
            try:
                messages = json.loads(row["messages"])
            except json.JSONDecodeError:
                messages = []
            return messages, row["revision"]

    def save(self, key: str, messages: list[dict]) -> None:
        import time

        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO sessions (key, messages, updated_at, revision)
                VALUES (?, ?, ?, 1)
                ON CONFLICT(key) DO UPDATE SET
                    messages   = excluded.messages,
                    updated_at = excluded.updated_at,
                    revision   = sessions.revision + 1
                """,
                (key, json.dumps(messages, ensure_ascii=False), time.time()),
            )
            conn.commit()

    def delete(self, key: str) -> None:
        with self._lock, self._connect() as conn:
            conn.execute("DELETE FROM sessions WHERE key = ?", (key,))
            conn.commit()

    def cleanup_old(self, max_age_days: int = 30) -> int:
        import time

        cutoff = time.time() - max_age_days * 86400
        with self._lock, self._connect() as conn:
            cur = conn.execute(
                "DELETE FROM sessions WHERE updated_at < ?", (cutoff,)
            )
            conn.commit()
            return cur.rowcount


_store = _SessionStore()


class ConversationManager:
    def __init__(self, namespace: str = "chat"):
        self.namespace = namespace

    def _key(self, session_id: str) -> str:
        return f"{self.namespace}:{session_id}"

    def get_history(self, session_id: str) -> list[dict]:
        return _store.load(self._key(session_id))

    def get_history_with_revision(self, session_id: str) -> tuple[list[dict], int]:
        return _store.load_with_revision(self._key(session_id))

    def add_turn(self, session_id: str, role: str, content: str) -> None:
        key = self._key(session_id)
        history = _store.load(key)
        history.append({"role": role, "content": content})
        if len(history) > MAX_HISTORY:
            history = history[-MAX_HISTORY:]
        _store.save(key, history)

    def clear_session(self, session_id: str) -> None:
        _store.delete(self._key(session_id))

    async def chat_stream(
        self,
        session_id: str,
        message: str,
        system: str = "",
        provider: str | None = None,
        model: str | None = None,
    ) -> AsyncGenerator[str, None]:
        history = self.get_history(session_id)
        messages = [*history, {"role": "user", "content": message}]

        full_response = ""
        try:
            async for token in astream_chat(
                messages, system=system, provider=provider, model=model,
            ):
                full_response += token
                yield token
        except Exception as e:
            raise RuntimeError(f"LLM error: {e}")

        self.add_turn(session_id, role="user", content=message)
        self.add_turn(session_id, role="assistant", content=full_response)
