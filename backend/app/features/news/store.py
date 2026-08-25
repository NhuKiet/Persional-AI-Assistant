"""Supabase-backed store for news_items. Mirrors
backend/app/shared/conversation_store.py's `_SupabaseSessionStore` — same
lazy-pool-on-first-use pattern, same synchronous psycopg_pool.ConnectionPool
(the write volume here is a few dozen rows every 6 hours; a synchronous
pool wrapped in asyncio.to_thread per call is simpler than standing up
AsyncConnectionPool for that load — see the design spec §5 for the
trade-off). This module owns its OWN pool, separate from
conversation_store's — different table, no reason to couple lifecycles.
"""
import logging
import threading

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from backend.app.core.config import settings
from backend.app.features.news.models import NewsItem

logger = logging.getLogger(__name__)


class _SupabaseNewsStore:
    def __init__(self):
        self._pool: ConnectionPool | None = None
        self._lock = threading.Lock()

    def _get_pool(self) -> ConnectionPool:
        if self._pool is None:
            with self._lock:
                if self._pool is None:
                    if not settings.SUPABASE_DB_URL:
                        raise RuntimeError("SUPABASE_DB_URL chưa cấu hình.")
                    pool = ConnectionPool(
                        conninfo=settings.SUPABASE_DB_URL,
                        min_size=1,
                        max_size=3,
                        timeout=5,
                        open=False,
                        kwargs={"row_factory": dict_row, "connect_timeout": 5},
                    )
                    try:
                        pool.open(wait=True, timeout=3.0)
                    except Exception:
                        pool.close()
                        raise
                    self._pool = pool
        return self._pool

    def close(self) -> None:
        if self._pool is not None:
            self._pool.close()
            self._pool = None

    def existing_urls(self, candidate_urls: list[str]) -> set[str]:
        if not candidate_urls:
            return set()
        with self._get_pool().connection() as conn:
            rows = conn.execute(
                "select url from news_items where url = any(%s)",
                (candidate_urls,),
            ).fetchall()
            return {r["url"] for r in rows}

    def add_new(self, items: list[NewsItem]) -> int:
        if not items:
            return 0
        inserted = 0
        with self._get_pool().connection() as conn:
            with conn.cursor() as cur:
                for i in items:
                    cur.execute(
                        """
                        insert into news_items
                            (url, title, title_vi, summary_vi, source, topic, published_at, fetched_at)
                        values (%s, %s, %s, %s, %s, %s, %s, %s)
                        on conflict (url) do nothing
                        returning id
                        """,
                        (i.url, i.title, i.title_vi, i.summary_vi, i.source, i.topic,
                         i.published_at, i.fetched_at),
                    )
                    if cur.fetchone() is not None:
                        inserted += 1
        return inserted

    def list_items(self, topic: str | None, limit: int, offset: int) -> tuple[list[NewsItem], bool]:
        with self._get_pool().connection() as conn:
            base_sql = """
                select url, title, title_vi, summary_vi, source, topic, published_at, fetched_at
                from news_items
                {where}
                order by published_at desc nulls last, fetched_at desc, id desc
                limit %s offset %s
            """
            if topic:
                sql = base_sql.format(where="where topic = %s")
                params = (topic, limit + 1, offset)
            else:
                sql = base_sql.format(where="")
                params = (limit + 1, offset)
            rows = conn.execute(sql, params).fetchall()
            has_more = len(rows) > limit
            rows = rows[:limit]
            items = [
                NewsItem(
                    url=r["url"], title=r["title"], description_raw="",
                    source=r["source"], topic=r["topic"],
                    published_at=r["published_at"], fetched_at=r["fetched_at"],
                    title_vi=r["title_vi"], summary_vi=r["summary_vi"],
                )
                for r in rows
            ]
            return items, has_more

    def prune_older_than(self, days: int) -> int:
        with self._get_pool().connection() as conn:
            rows = conn.execute(
                "delete from news_items where fetched_at < now() - (%s || ' days')::interval returning id",
                (days,),
            ).fetchall()
            return len(rows)


_store: _SupabaseNewsStore = _SupabaseNewsStore()
