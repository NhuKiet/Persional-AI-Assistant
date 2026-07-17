"""backend/app/features/research/search — tìm kiếm đa nguồn cho Research pipeline.

Trước đây tất cả nằm trong tools/searchers.py (726 dòng). Tách theo trách nhiệm:

    query.py      phân loại query → k động, mở rộng query
    ranking.py    rerank + credibility (ủy quyền BGE về backend/app/features/research/reranker.py)
    crawl.py      crawl full-text làm giàu kết quả web
    web.py        WebSearcher (Tavily)
    academic.py   Arxiv, Semantic Scholar, OpenAlex
    community.py  Wikipedia, HuggingFace, GitHub

Mặt tiền công khai giữ nguyên như searchers.py cũ để research_agent không phải
biết bố cục bên trong.
"""
from backend.app.features.research.reranker import _CREDIBILITY
from backend.app.features.research.search.academic import ArxivSearcher, OpenAlexSearcher, SemanticScholarSearcher
from backend.app.features.research.search.community import GitHubSearcher, HuggingFaceSearcher, WikipediaSearcher
from backend.app.features.research.search.crawl import _crawl_url, _enrich_web_results
from backend.app.features.research.search.query import expand_query, get_dynamic_k
from backend.app.features.research.search.ranking import _get_reranker, rerank_results
from backend.app.features.research.search.web import WebSearcher

__all__ = [
    "ArxivSearcher",
    "GitHubSearcher",
    "HuggingFaceSearcher",
    "OpenAlexSearcher",
    "SemanticScholarSearcher",
    "WebSearcher",
    "WikipediaSearcher",
    "expand_query",
    "get_dynamic_k",
    "rerank_results",
    "_crawl_url",
    "_enrich_web_results",
    "_get_reranker",
    "_CREDIBILITY",
]
