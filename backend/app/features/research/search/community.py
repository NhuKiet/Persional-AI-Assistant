"""tools/search/community.py — nguon cong dong: HuggingFace, Stack Overflow."""
import logging
import re

import httpx

from backend.app.features.research.grounding import shares_anchor_token
from backend.app.features.research.models import SearchResult

logger = logging.getLogger(__name__)

_DAILY_PAPERS_URL = "https://huggingface.co/api/daily_papers"

# HuggingFace's papers-search endpoint ignores the `search` param server-side
# — verified empirically: it returns the exact same "today's trending papers"
# list for a real query and for a nonsense one. Trusting it as a real search
# floods every research run with irrelevant trending papers (dedup/rerank
# don't catch it, since these get real nonzero scores from upvotes). Filter
# client-side with the shared anchor-token check instead.


def fetch_trending_papers(k: int = 6) -> list[str]:
    """Tiêu đề các paper nổi bật hôm nay trên HuggingFace — dùng làm gợi ý
    'nghiên cứu mới' ở trang Research, độc lập với HuggingFaceSearcher (không
    cần query). Không cần key, không cache ở tầng này — caller (router) tự
    cache theo TTL để tránh gọi HF mỗi lần tải trang."""
    try:
        resp = httpx.get(_DAILY_PAPERS_URL, params={"limit": k}, timeout=8)
        resp.raise_for_status()
        titles = []
        for item in resp.json()[:k]:
            title = (item.get("paper") or {}).get("title") or item.get("title") or ""
            title = title.strip()
            if title:
                titles.append(title)
        return titles
    except Exception as e:
        logger.error("Fetch trending papers failed: %s", e)
        return []


class HuggingFaceSearcher:
    _PAPERS_URL = "https://huggingface.co/api/papers"

    def search(self, query: str, k: int = 5) -> list[SearchResult]:
        return self._search_papers(query, k)

    def _search_papers(self, query: str, k: int) -> list[SearchResult]:
        try:
            resp = httpx.get(self._PAPERS_URL, params={"search": query, "limit": k}, timeout=10)
            resp.raise_for_status()
            results = []
            for p in resp.json()[:k]:
                paper_id  = p.get("id", "")
                title     = p.get("title", "")
                abstract  = p.get("abstract", "")[:2000]
                upvotes   = p.get("upvotes", 0)
                arxiv_id  = p.get("arxivId") or ""
                pdf_url   = f"https://arxiv.org/pdf/{arxiv_id}" if arxiv_id else ""
                url       = f"https://huggingface.co/papers/{paper_id}" if paper_id else ""
                results.append(SearchResult(
                    source="huggingface",
                    title=title,
                    url=url,
                    content=abstract,
                    score=min(1.0, upvotes / 100),
                    extra={
                        "pdf_url":  pdf_url,
                        "arxiv_id": arxiv_id,
                        "upvotes":  upvotes,
                    },
                ))
            relevant = [r for r in results if shares_anchor_token(query, r.title, r.content)]
            if len(relevant) < len(results):
                logger.info(
                    "HuggingFace papers: dropped %d/%d irrelevant (search param ignored by API)",
                    len(results) - len(relevant), len(results),
                )
            return relevant
        except Exception as e:
            logger.error("HuggingFace papers search failed: %s", e)
            return []

class StackOverflowSearcher:
    """Stack Exchange API (site=stackoverflow) — không cần API key cho search cơ bản."""
    _SEARCH_URL = "https://api.stackexchange.com/2.3/search/advanced"

    def search(self, query: str, k: int = 4) -> list[SearchResult]:
        try:
            resp = httpx.get(
                self._SEARCH_URL,
                params={
                    "q":        query,
                    "site":     "stackoverflow",
                    "pagesize": k,
                    "order":    "desc",
                    "sort":     "relevance",
                    "filter":   "!9_bDE(fI5",  # includes body
                },
                timeout=10,
            )
            resp.raise_for_status()
            results = []
            for item in resp.json().get("items", [])[:k]:
                title      = item.get("title", "")
                score      = item.get("score", 0)
                answered    = item.get("is_answered", False)
                answers    = item.get("answer_count", 0)
                tags       = item.get("tags", [])[:5]
                body       = (item.get("body") or "")
                snippet = re.sub("<[^<]+?>", " ", body).strip()[:2000]
                results.append(SearchResult(
                    source="stackoverflow",
                    title=title,
                    url=item.get("link", ""),
                    content=snippet or title,
                    score=min(1.0, score / 50),
                    extra={
                        "score":       score,
                        "answered":    answered,
                        "answers":     answers,
                        "tags":        tags,
                    },
                ))
            return results
        except Exception as e:
            logger.error("Stack Overflow search failed: %s", e)
            return []
