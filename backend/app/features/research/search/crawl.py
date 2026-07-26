"""tools/search/crawl.py — crawl full-text lam giau ket qua web (trafilatura)."""
import ipaddress
import logging
import socket
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse

import httpx

from backend.app.features.research.models import SearchResult

logger = logging.getLogger(__name__)

try:
    import trafilatura
    _TRAFILATURA_OK = True
except ImportError:
    _TRAFILATURA_OK = False
    logger.warning("trafilatura not installed - full-crawl disabled. Run: pip install trafilatura")


def _is_safe_url(url: str) -> bool:
    """SSRF guard: only allow http(s) URLs whose resolved address is a
    public IP. Search results (Tavily, etc.) point at arbitrary external
    pages we don't control — without this, a malicious/compromised result
    (or a redirect chain) could make the server fetch internal services
    (localhost, cloud metadata endpoints, RFC1918 ranges)."""
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return False
        for _family, _type, _proto, _canon, sockaddr in socket.getaddrinfo(parsed.hostname, None):
            ip = ipaddress.ip_address(sockaddr[0])
            if (
                ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_reserved or ip.is_multicast or ip.is_unspecified
            ):
                return False
        return True
    except Exception:
        return False


def _guard_redirects(request: httpx.Request) -> None:
    """httpx event hook — re-validates every hop (initial request + each
    redirect target), so a safe URL that 302s to an internal address is
    still blocked."""
    if not _is_safe_url(str(request.url)):
        raise httpx.RequestError(f"blocked unsafe URL (SSRF guard): {request.url}")


def _crawl_url(url: str, timeout: int = 8) -> str | None:
    """Fetch and extract full article text using trafilatura."""
    if not _TRAFILATURA_OK or not url or not _is_safe_url(url):
        return None
    try:
        with httpx.Client(
            timeout=timeout, follow_redirects=True,
            event_hooks={"request": [_guard_redirects]},
        ) as client:
            resp = client.get(url, headers={"User-Agent": "Mozilla/5.0 (research-agent)"})
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
        try:
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
        except TimeoutError:
            # Overall crawl deadline hit — keep whatever got enriched so far
            # instead of propagating and crashing the caller (agent.py).
            logger.warning("Trafilatura crawl timed out after 20s; using partial enrichment")

    enriched_count = sum(
        1 for i in web_indices
        if len(enriched[i].content) > len(results[i].content)
    )
    logger.info("Trafilatura: enriched %d/%d web results", enriched_count, len(web_indices))
    return enriched


# ─────────────────────────────────────────────────────────────────────────────
# Helper
# ─────────────────────────────────────────────────────────────────────────────

