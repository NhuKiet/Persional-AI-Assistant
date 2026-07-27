"""backend/app/features/research/search/academic.py — nguon hoc thuat: Arxiv, Semantic Scholar, OpenAlex."""
import logging
import time
import urllib.parse

import arxiv
import httpx

from backend.app.core.config import settings
from backend.app.features.research.models import SearchResult
from backend.app.features.research.search.web import _ascii_query

logger = logging.getLogger(__name__)


class ArxivSearcher:
    _RETRIES = 3
    _BACKOFF  = [2.0, 5.0, 10.0]
    _DELAY    = 3.0

    def search(self, query: str, k: int = 4) -> list[SearchResult]:
        clean_query = _ascii_query(query)
        last_err    = None

        for attempt in range(self._RETRIES):
            try:
                if attempt > 0:
                    wait = self._BACKOFF[min(attempt - 1, len(self._BACKOFF) - 1)]
                    logger.warning("Arxiv retry %d — waiting %.1fs", attempt + 1, wait)
                    time.sleep(wait)

                client = arxiv.Client(
                    page_size=k,
                    delay_seconds=self._DELAY,
                    num_retries=1,
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
                if "429" in str(e):
                    logger.warning("Arxiv rate limited (attempt %d): %s", attempt + 1, e)
                else:
                    logger.warning("Arxiv attempt %d failed: %s", attempt + 1, e)

        logger.error("Arxiv search failed after %d attempts: %s", self._RETRIES, last_err)
        return []



class SemanticScholarSearcher:
    _BASE   = "https://api.semanticscholar.org/graph/v1"
    _FIELDS = "title,abstract,authors,year,citationCount,openAccessPdf,url"
    _RETRIES = 3
    _BACKOFF = [1.0, 2.5, 5.0]

    def __init__(self):
        key = settings.S2_API_KEY
        self._headers = {"x-api-key": key} if key else {}

    def search(self, query: str, k: int = 5) -> list[SearchResult]:
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
                    wait = self._BACKOFF[min(attempt, len(self._BACKOFF) - 1)]
                    logger.warning("Semantic Scholar rate limited — retrying in %.1fs", wait)
                    time.sleep(wait)
                    continue
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

