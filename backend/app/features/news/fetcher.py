"""Async RSS ingestion. feedparser is a blocking, network-fetching library
(`feedparser.parse(url)` opens its own connection with no reliable timeout),
so this module NEVER calls it with a URL — httpx.AsyncClient does the
fetching (real timeouts, redirect cap, size cap, bounded concurrency), and
feedparser only ever parses already-downloaded in-memory bytes.
"""
import asyncio
import logging
from datetime import datetime, timezone

import feedparser
import httpx

from backend.app.core.config import settings
from backend.app.features.news.models import NewsItem, normalize_url
from backend.app.features.news.sources import SOURCES

logger = logging.getLogger(__name__)

_CONNECT_TIMEOUT = 5.0
_READ_TIMEOUT = 10.0
_MAX_REDIRECTS = 3
_MAX_BYTES = 2 * 1024 * 1024  # 2 MB — RSS feeds are small; anything bigger is abnormal
_CONCURRENCY = 6


def _build_client() -> httpx.AsyncClient:
    timeout = httpx.Timeout(connect=_CONNECT_TIMEOUT, read=_READ_TIMEOUT, write=_READ_TIMEOUT, pool=_READ_TIMEOUT)
    return httpx.AsyncClient(timeout=timeout, max_redirects=_MAX_REDIRECTS, follow_redirects=True)


def _entry_published_at(entry) -> datetime | None:
    struct = entry.get("published_parsed") or entry.get("updated_parsed")
    if not struct:
        return None
    return datetime(*struct[:6], tzinfo=timezone.utc)


async def _fetch_body(client: httpx.AsyncClient, feed_url: str) -> bytes | None:
    try:
        async with client.stream("GET", feed_url) as resp:
            resp.raise_for_status()
            chunks = bytearray()
            async for chunk in resp.aiter_bytes():
                chunks.extend(chunk)
                if len(chunks) > _MAX_BYTES:
                    logger.warning("[NEWS] feed %s exceeded %d bytes — truncated", feed_url, _MAX_BYTES)
                    break
            return bytes(chunks)
    except Exception as e:
        logger.warning("[NEWS] fetch failed for %s: %s", feed_url, e)
        return None


def _parse_entries(body: bytes, source: str, topic: str) -> list[NewsItem]:
    parsed = feedparser.parse(body)
    items: list[NewsItem] = []
    now = datetime.now(timezone.utc)
    for entry in parsed.entries[: settings.NEWS_MAX_ITEMS_PER_FEED]:
        url = normalize_url(entry.get("link", ""))
        if not url:
            continue
        published_at = _entry_published_at(entry)
        if published_at is not None and (now - published_at).days > settings.NEWS_MAX_ITEM_AGE_DAYS:
            continue
        title = (entry.get("title") or "").strip()
        if not title:
            continue
        description = (entry.get("summary") or entry.get("description") or "").strip()
        items.append(NewsItem(
            url=url,
            title=title,
            description_raw=description[: settings.NEWS_DESCRIPTION_TRUNCATE_CHARS],
            source=source,
            topic=topic,
            published_at=published_at,
            fetched_at=now,
        ))
    return items


async def _fetch_one(client: httpx.AsyncClient, sem: asyncio.Semaphore, feed_url: str, source: str, topic: str) -> list[NewsItem]:
    async with sem:
        body = await _fetch_body(client, feed_url)
    if body is None:
        return []
    try:
        return _parse_entries(body, source, topic)
    except Exception as e:
        logger.warning("[NEWS] parse failed for %s: %s", feed_url, e)
        return []


async def fetch_all_sources() -> list[NewsItem]:
    """Fetch every configured RSS source in parallel (bounded concurrency).
    One source's failure never blocks the others — each is caught and
    logged individually inside `_fetch_one`/`_fetch_body`.
    """
    sem = asyncio.Semaphore(_CONCURRENCY)
    async with _build_client() as client:
        results = await asyncio.gather(*[
            _fetch_one(client, sem, feed_url, source, topic)
            for feed_url, source, topic in SOURCES
        ])
    return [item for batch in results for item in batch]
