"""tools/search/crawl.py — crawl full-text lam giau ket qua web (trafilatura)."""
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx

from backend.app.features.research.models import SearchResult

logger = logging.getLogger(__name__)

try:
    import trafilatura
    _TRAFILATURA_OK = True
except ImportError:
    _TRAFILATURA_OK = False
    logger.warning("trafilatura not installed - full-crawl disabled. Run: pip install trafilatura")


def _crawl_url(url: str, timeout: int = 8) -> str | None:
    """Fetch and extract full article text using trafilatura."""
    if not _TRAFILATURA_OK or not url:
        return None
    try:
        resp = httpx.get(url, timeout=timeout, follow_redirects=True,
                         headers={"User-Agent": "Mozilla/5.0 (research-agent)"})
        if resp.status_code != 200:
            return None
        text = trafilatura.extract(
            resp.text,
            include_comments=False,
            include_tables=True,
            no_fallback=False,
        )
        return text
    except Exception:
        return None


def _enrich_web_results(results: list[SearchResult], max_workers: int = 6) -> list[SearchResult]:
    """
    For web results, fetch full article content via trafilatura.
    Falls back to original snippet if crawl fails.
    """
    if not _TRAFILATURA_OK:
        return results

    web_indices = [i for i, r in enumerate(results) if r.source == "web"]
    if not web_indices:
        return results

    def _fetch(i: int) -> tuple[int, str | None]:
        return i, _crawl_url(results[i].url)

    enriched = list(results)  # shallow copy
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = {ex.submit(_fetch, i): i for i in web_indices}
        for future in as_completed(futures, timeout=20):
            try:
                idx, full_text = future.result()
                if full_text and len(full_text) > len(enriched[idx].content):
                    # Cap at 8000 chars to avoid overwhelming LLM context
                    enriched[idx] = SearchResult(
                        source=enriched[idx].source,
                        title=enriched[idx].title,
                        url=enriched[idx].url,
                        content=full_text[:8000],
                        score=enriched[idx].score,
                        extra=enriched[idx].extra,
                    )
                    logger.debug(
                        "Enriched '%s': %d → %d chars",
                        enriched[idx].title[:40], len(results[idx].content), len(full_text),
                    )
            except Exception as e:
                logger.debug("Crawl future error: %s", e)

    enriched_count = sum(
        1 for i in web_indices
        if len(enriched[i].content) > len(results[i].content)
    )
    logger.info("Trafilatura: enriched %d/%d web results", enriched_count, len(web_indices))
    return enriched


# ─────────────────────────────────────────────────────────────────────────────
# Helper
# ─────────────────────────────────────────────────────────────────────────────

