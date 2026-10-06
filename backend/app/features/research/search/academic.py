"""backend/app/features/research/search/academic.py — nguon hoc thuat: Arxiv, Semantic Scholar, OpenAlex."""
import logging
import threading
import time
from collections.abc import Callable

import arxiv
import httpx

from backend.app.core.config import settings
from backend.app.features.research.models import SearchResult
from backend.app.features.research.search.web import _ascii_query

logger = logging.getLogger(__name__)

# How long to leave a source alone after it answers 429. Measured 2026-09-29:
# arXiv and Semantic Scholar kept answering 429 for minutes, and retrying with
# back-offs only held the whole search round open until its deadline. Resting
# the source makes later questions skip it at once instead.
COOLDOWN_SECONDS = 120.0
# arXiv's API terms: no more than one request every 3 seconds.
ARXIV_SPACING_SECONDS = 3.0


class SourceCooldowns:
    """Which sources answered 429 recently, and until when to skip them."""

    def __init__(self, clock: Callable[[], float] = time.monotonic):
        self._clock = clock
        self._lock = threading.Lock()
        self._until: dict[str, float] = {}

    def resting(self, source: str) -> bool:
        with self._lock:
            return self._clock() < self._until.get(source, 0.0)

    def rest(self, source: str, seconds: float = COOLDOWN_SECONDS) -> None:
        with self._lock:
            self._until[source] = self._clock() + seconds
        logger.warning("%s rate limited (429) — skipping it for %.0fs", source, seconds)

    def reset(self) -> None:
        with self._lock:
            self._until.clear()


cooldowns = SourceCooldowns()


class RequestSpacing:
    """Lets requests through no closer together than `seconds` — callers
    queue on the lock, so parallel expansion queries go out one by one."""

    def __init__(self, seconds: float, clock: Callable[[], float] = time.monotonic,
                 sleep: Callable[[float], None] = time.sleep):
        self._seconds = seconds
        self._clock = clock
        self._sleep = sleep
        self._lock = threading.Lock()
        self._last: float | None = None

    def wait(self) -> None:
        with self._lock:
            now = self._clock()
            if self._last is not None:
                delay = self._last + self._seconds - now
                if delay > 0:
                    self._sleep(delay)
                    now += delay
            self._last = now


_arxiv_gate = RequestSpacing(ARXIV_SPACING_SECONDS)


def _is_rate_limit(error: Exception) -> bool:
    return "429" in str(error)


class ArxivSearcher:
    # One retry for a network hiccup; none for a 429 (see COOLDOWN_SECONDS).
    _RETRIES = 2
    _BACKOFF  = [2.0]

    def search(self, query: str, k: int = 4) -> list[SearchResult]:
        if cooldowns.resting("arxiv"):
            return []
        clean_query = _ascii_query(query)
        last_err    = None

        for attempt in range(self._RETRIES):
            try:
                if attempt > 0:
                    wait = self._BACKOFF[min(attempt - 1, len(self._BACKOFF) - 1)]
                    logger.warning("Arxiv retry %d — waiting %.1fs", attempt + 1, wait)
                    time.sleep(wait)

                _arxiv_gate.wait()
                if cooldowns.resting("arxiv"):
                    return []  # a query queued ahead of us just hit a 429
                # Pacing and retries are ours (above): the client's own
                # retry loop would sleep through 429s we want to give up on.
                client = arxiv.Client(
                    page_size=k,
                    delay_seconds=0,
                    num_retries=0,
                )
                search = arxiv.Search(
                    query=clean_query,
                    max_results=k,
                    sort_by=arxiv.SortCriterion.Relevance,
                )
                results = []
                for paper in client.results(search):
                    results.append(SearchResult(
                        source="arxiv",
                        title=paper.title,
                        url=paper.entry_id,
                        content=paper.summary[:2000],
                        extra={
                            "pdf_url":    paper.pdf_url,
                            "authors":    [str(a) for a in paper.authors[:5]],
                            "published":  str(paper.published.date()),
                            "year":       paper.published.year,
                            "categories": paper.categories[:3],
                            "arxiv_id":   paper.entry_id.split("/")[-1],
                        },
                    ))
                return results

            except Exception as e:
                last_err = e
                if _is_rate_limit(e):
                    cooldowns.rest("arxiv")
                    return []
                logger.warning("Arxiv attempt %d failed: %s", attempt + 1, e)

        logger.error("Arxiv search failed after %d attempts: %s", self._RETRIES, last_err)
        return []



class SemanticScholarSearcher:
    _BASE   = "https://api.semanticscholar.org/graph/v1"
    _FIELDS = "title,abstract,authors,year,citationCount,openAccessPdf,url"
    # One retry for a network error or a 5xx; a 429 rests the source instead.
    _RETRIES = 2

    def __init__(self):
        key = settings.S2_API_KEY
        self._headers = {"x-api-key": key} if key else {}

    def search(self, query: str, k: int = 5) -> list[SearchResult]:
        if cooldowns.resting("semantic_scholar"):
            return []
        last_err = None
        for attempt in range(self._RETRIES):
            try:
                resp = httpx.get(
                    f"{self._BASE}/paper/search",
                    params={"query": query, "limit": k, "fields": self._FIELDS},
                    headers=self._headers,
                    timeout=20,
                )
                if resp.status_code == 429:
                    # Without an API key this is the shared, heavily used
                    # pool: waiting a few seconds rarely helps (S2_API_KEY does).
                    cooldowns.rest("semantic_scholar")
                    return []
                if resp.status_code == 200:
                    data = resp.json().get("data", [])
                    results = []
                    for p in data:
                        abstract = (p.get("abstract") or "").strip()
                        title    = (p.get("title") or "").strip()
                        if not abstract and not title:
                            continue
                        content = abstract if abstract else f"Paper: {title}"
                        pdf_url = (p.get("openAccessPdf") or {}).get("url", "")
                        results.append(SearchResult(
                            source="semantic_scholar",
                            title=title,
                            url=p.get("url", "") or f"https://api.semanticscholar.org/paper/{p.get('paperId','')}",
                            content=content[:2000],
                            score=min(1.0, (p.get("citationCount") or 0) / 200),
                            extra={
                                "authors":        [a.get("name") for a in p.get("authors", [])[:5]],
                                "year":           p.get("year"),
                                "citation_count": p.get("citationCount", 0),
                                "pdf_url":        pdf_url,
                            },
                        ))
                    return results
                resp.raise_for_status()
            except Exception as e:
                last_err = e
                logger.warning("Semantic Scholar attempt %d failed: %s", attempt + 1, e)
        logger.error("Semantic Scholar failed after %d attempts: %s", self._RETRIES, last_err)
        return []

