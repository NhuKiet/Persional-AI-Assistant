"""tools/search/community.py — nguon cong dong: Wikipedia, HuggingFace, GitHub."""
import logging

import httpx

from backend.app.core.config import settings
from backend.app.features.research.models import SearchResult

logger = logging.getLogger(__name__)

try:
    import wikipedia
    _WIKIPEDIA_OK = True
except ImportError:
    _WIKIPEDIA_OK = False


class WikipediaSearcher:
    def search(self, query: str, k: int = 2) -> list[SearchResult]:
        if not _WIKIPEDIA_OK:
            return []
        try:
            wikipedia.set_lang("en")
            titles  = wikipedia.search(query, results=k + 2)
            results = []
            for title in titles:
                try:
                    page = wikipedia.page(title, auto_suggest=False)
                    results.append(SearchResult(
                        source="wikipedia",
                        title=page.title,
                        url=page.url,
                        content=page.summary[:2000],
                    ))
                    if len(results) >= k:
                        break
                except wikipedia.exceptions.DisambiguationError as e:
                    try:
                        page = wikipedia.page(e.options[0], auto_suggest=False)
                        results.append(SearchResult(
                            source="wikipedia",
                            title=page.title,
                            url=page.url,
                            content=page.summary[:2000],
                        ))
                    except Exception:
                        continue
                except Exception:
                    continue
            return results
        except Exception as e:
            logger.error("Wikipedia search failed: %s", e)
            return []



class HuggingFaceSearcher:
    _PAPERS_URL = "https://huggingface.co/api/papers"
    _MODELS_URL = "https://huggingface.co/api/models"

    def search(self, query: str, k: int = 5) -> list[SearchResult]:
        results = self._search_papers(query, k)
        if not results:
            results = self._search_models(query, k)
        return results

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
            return results
        except Exception as e:
            logger.error("HuggingFace papers search failed: %s", e)
            return []

    def _search_models(self, query: str, k: int) -> list[SearchResult]:
        try:
            resp = httpx.get(
                self._MODELS_URL,
                params={"search": query, "limit": k, "sort": "downloads"},
                timeout=10,
            )
            resp.raise_for_status()
            results = []
            for m in resp.json()[:k]:
                model_id = m.get("modelId", "")
                results.append(SearchResult(
                    source="huggingface",
                    title=model_id,
                    url=f"https://huggingface.co/{model_id}",
                    content=(
                        f"Downloads: {m.get('downloads', 0):,} | "
                        f"Likes: {m.get('likes', 0)} | "
                        f"Tags: {', '.join(m.get('tags', [])[:6])}"
                    ),
                    extra={
                        "downloads": m.get("downloads", 0),
                        "likes":     m.get("likes", 0),
                        "tags":      m.get("tags", [])[:6],
                    },
                ))
            return results
        except Exception as e:
            logger.error("HuggingFace model search failed: %s", e)
            return []



class GitHubSearcher:
    _SEARCH_URL = "https://api.github.com/search/repositories"
    _README_URL = "https://api.github.com/repos/{owner}/{repo}/readme"

    def __init__(self):
        token = settings.GITHUB_TOKEN
        self.headers = {
            "Accept":               "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if token:
            self.headers["Authorization"] = f"Bearer {token}"
        else:
            logger.warning("GITHUB_TOKEN not set — rate limited to 60 req/hr")

    def search(self, query: str, k: int = 5) -> list[SearchResult]:
        try:
            resp = httpx.get(
                self._SEARCH_URL,
                params={"q": query, "sort": "stars", "order": "desc", "per_page": k},
                headers=self.headers,
                timeout=10,
            )
            resp.raise_for_status()
            results = []
            for repo in resp.json().get("items", [])[:k]:
                full_name   = repo.get("full_name", "")
                description = repo.get("description") or ""
                stars       = repo.get("stargazers_count", 0)
                language    = repo.get("language") or ""
                topics      = repo.get("topics", [])[:5]
                readme      = self._fetch_readme(full_name)
                content = (
                    f"{description}\n\n"
                    f"Stars: {stars:,} | Language: {language} | Topics: {', '.join(topics)}\n\n"
                    f"{readme}"
                )[:2000]
                results.append(SearchResult(
                    source="github",
                    title=full_name,
                    url=repo.get("html_url", ""),
                    content=content,
                    score=min(1.0, stars / 10000),
                    extra={
                        "stars":       stars,
                        "language":    language,
                        "topics":      topics,
                        "description": description,
                    },
                ))
            return results
        except Exception as e:
            logger.error("GitHub search failed: %s", e)
            return []

    def _fetch_readme(self, full_name: str) -> str:
        try:
            owner, repo = full_name.split("/", 1)
            resp = httpx.get(
                self._README_URL.format(owner=owner, repo=repo),
                headers={**self.headers, "Accept": "application/vnd.github.raw+json"},
                timeout=8,
            )
            resp.raise_for_status()
            return resp.text[:1000]
        except Exception:
            return ""


