"""tools/search/web.py — tim kiem web qua Tavily."""
import logging

from tavily import TavilyClient

from backend.app.core.config import settings
from backend.app.features.research.models import SearchResult
from backend.app.features.research.search.crawl import _enrich_web_results

logger = logging.getLogger(__name__)


_TAVILY_PRIORITY_DOMAINS = [
    "arxiv.org", "semanticscholar.org", "huggingface.co",
    "github.com", "wikipedia.org", "nature.com",
    "sciencedirect.com", "springer.com", "ieee.org",
    "openai.com", "deepmind.com",
]


def _ascii_query(query: str) -> str:
    import unicodedata
    cleaned = "".join(
        c for c in unicodedata.normalize("NFD", query)
        if unicodedata.category(c) != "Mn" and ord(c) < 128
    ).strip()
    return cleaned if len(cleaned) >= max(3, len(query) // 3) else query


# ─────────────────────────────────────────────────────────────────────────────
# Searchers
# ─────────────────────────────────────────────────────────────────────────────

class WebSearcher:
    def __init__(self):
        key = settings.TAVILY_API_KEY
        self.client       = TavilyClient(api_key=key) if key else None
        self.boost_blogs  = settings.TAVILY_BOOST_BLOGS

    def search(self, query: str, k: int = 6) -> list[SearchResult]:
        if not self.client:
            logger.warning("TAVILY_API_KEY missing — web search disabled")
            return []
        try:
            kwargs: dict = dict(
                query=query,
                search_depth="advanced",
                max_results=k,
            )
            if self.boost_blogs:
                kwargs["include_domains"] = _TAVILY_PRIORITY_DOMAINS

            resp    = self.client.search(**kwargs)
            results = []
            for r in resp.get("results", []):
                if r.get("score", 0) < 0.4:
                    continue
                results.append(SearchResult(
                    source="web",
                    title=r.get("title", ""),
                    url=r.get("url", ""),
                    content=r.get("content", "")[:2000],
                    score=r.get("score", 1.0),
                ))
            return results
        except Exception as e:
            logger.error("Web search failed: %s", e)
            return []


class DuckDuckGoSearcher:
    """Không cần API key — backup/song song với Tavily."""

    def search(self, query: str, k: int = 6) -> list[SearchResult]:
        try:
            from ddgs import DDGS
            results = []
            with DDGS() as ddgs:
                for r in ddgs.text(query, max_results=k):
                    results.append(SearchResult(
                        source="duckduckgo",
                        title=r.get("title", ""),
                        url=r.get("href", ""),
                        content=(r.get("body", "") or "")[:2000],
                    ))
            return results
        except Exception as e:
            logger.error("DuckDuckGo search failed: %s", e)
            return []


