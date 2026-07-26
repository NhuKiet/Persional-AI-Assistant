import datetime
import logging
import threading
from typing import AsyncGenerator

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from backend.app.core.config import settings
from backend.app.core.llm import astream_chat


logger = logging.getLogger(__name__)

MAX_HISTORY = settings.MAX_HISTORY

_DEFAULT_PROFILE_ID = "00000000-0000-0000-0000-000000000001"


class _SupabaseSessionStore:
    """Postgres-backed session store, reached via a direct `psycopg`
    connection rather than `supabase-py`/PostgREST — `save()` needs a real
    multi-statement transaction (upsert, row lock, delete, bulk insert,
    revision bump) that a sequence of separate HTTP calls cannot provide.

    The constructor performs no I/O. Config is validated and the pool is
    opened only inside `_get_pool()`, on first real use — constructing this
    eagerly at module import time (as the module-level `_store` singleton
    does) must never raise, or every test's ability to monkeypatch `_store`
    before it's used breaks at collection time.
    """

    def __init__(self):
        self._pool: ConnectionPool | None = None
        self._lock = threading.Lock()

    def _get_pool(self) -> ConnectionPool:
        if self._pool is None:
            with self._lock:
                if self._pool is None:
                    if not settings.SUPABASE_DB_URL:
                        raise RuntimeError("SUPABASE_DB_URL chưa cấu hình.")
                    # Build + open BEFORE publishing to self._pool — otherwise
                    # a racing reader on the unlocked fast path above could
                    # see a non-None pool that isn't open yet and hit
                    # PoolClosed. Publish only once open() has succeeded.
                    pool = ConnectionPool(
                        conninfo=settings.SUPABASE_DB_URL,
                        min_size=1,
                        max_size=5,
                        timeout=5,
                        open=False,
                        kwargs={"row_factory": dict_row, "connect_timeout": 5},
                    )
                    try:
                        pool.open(wait=True)
                    except Exception:
                        # open() failed (e.g. DB unreachable) — this pool's
                        # background reconnect workers must be shut down
                        # explicitly, or every failed attempt during an
                        # outage leaks one. Never publish a pool that never
                        # opened; the next call retries construction fresh.
                        pool.close()
                        raise
                    self._pool = pool
        return self._pool

    def close(self) -> None:
        if self._pool is not None:
            self._pool.close()
            self._pool = None

    def load(self, key: str) -> list[dict]:
        return self.load_with_revision(key)[0]

    def load_with_revision(self, key: str) -> tuple[list[dict], int]:
        with self._get_pool().connection() as conn:
            session = conn.execute(
                "select id, revision from sessions where user_id = %s and client_key = %s",
                (_DEFAULT_PROFILE_ID, key),
            ).fetchone()
            if session is None:
                return [], 0
            rows = conn.execute(
                "select role, content from messages where session_id = %s order by id",
                (session["id"],),
            ).fetchall()
            messages = [{"role": r["role"], "content": r["content"]} for r in rows]
            return messages, session["revision"]

    def save(self, key: str, messages: list[dict]) -> None:
        # One transaction. `with pool.connection() as conn:` commits
        # automatically on clean exit and rolls back automatically if
        # anything inside raises — do not call conn.commit() in this
        # method, doing so would split this into two transactions and
        # defeat the atomicity this whole design exists for.
        with self._get_pool().connection() as conn:
            conn.execute(
                """
                insert into sessions (user_id, client_key)
                values (%s, %s)
                on conflict (user_id, client_key) do nothing
                """,
                (_DEFAULT_PROFILE_ID, key),
            )
            session = conn.execute(
                """
                select id from sessions
                where user_id = %s and client_key = %s
                for update
                """,
                (_DEFAULT_PROFILE_ID, key),
            ).fetchone()
            session_id = session["id"]

            conn.execute("delete from messages where session_id = %s", (session_id,))
            if messages:
                with conn.cursor() as cur:
                    cur.executemany(
                        "insert into messages (session_id, role, content) values (%s, %s, %s)",
                        [(session_id, m["role"], Jsonb(m["content"])) for m in messages],
                    )
            conn.execute(
                "update sessions set revision = revision + 1, updated_at = now() where id = %s",
                (session_id,),
            )

    def delete(self, key: str) -> None:
        with self._get_pool().connection() as conn:
            conn.execute(
                "delete from sessions where user_id = %s and client_key = %s",
                (_DEFAULT_PROFILE_ID, key),
            )

    def cleanup_old(self, max_age_days: int = 30) -> int:
        cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=max_age_days)
        with self._get_pool().connection() as conn:
            rows = conn.execute(
                """
                delete from sessions
                where user_id = %s and updated_at < %s
                returning id
                """,
                (_DEFAULT_PROFILE_ID, cutoff),
            ).fetchall()
            return len(rows)


_store = _SupabaseSessionStore()


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
