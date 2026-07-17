"""backend/app/features/research/search/ranking.py — rerank ket qua search + trong so credibility.

BGE reranker KHONG load o day: uy quyen ve backend/app/features/research/reranker.py, noi load duy nhat.
"""
import logging
import math

from backend.app.features.research.models import SearchResult
from backend.app.features.research.reranker import _bge_reranker, _CREDIBILITY

logger = logging.getLogger(__name__)


def _get_reranker():
    """Delegate về reranker.py (nơi load BGE duy nhất)."""
    return _bge_reranker()


# ─────────────────────────────────────────────────────────────────────────────
# Query classifier → dynamic k
# ─────────────────────────────────────────────────────────────────────────────

def rerank_results(
    query:     str,
    results:   list[SearchResult],
    top_k:     int   = 15,
) -> list[SearchResult]:
    """
    Rerank results using BGE-Reranker + credibility score.
    Falls back to credibility-only scoring if reranker unavailable.
    """
    if not results:
        return results

    reranker = _get_reranker()

    if reranker is not None:
        try:
            pairs = [(query, f"{r.title} {r.content[:500]}") for r in results]
            scores = reranker.compute_score(pairs, normalize=True)

            ranked = []
            for result, rerank_score in zip(results, scores):
                cred   = _CREDIBILITY.get(result.source, 0.5)
                # Weighted combination: reranker 60%, credibility 25%, original score 15%
                final  = rerank_score * 0.60 + cred * 0.25 + result.score * 0.15
                ranked.append((result, final))

            ranked.sort(key=lambda x: x[1], reverse=True)
            top = [r for r, _ in ranked[:top_k]]

            logger.info(
                "Reranked %d → top %d results (BGE reranker)",
                len(results), len(top),
            )
            return top

        except Exception as e:
            logger.warning("BGE reranker failed, falling back to credibility scoring: %s", e)

    # Fallback: credibility + citation + recency scoring
    ranked = []
    for r in results:
        cred      = _CREDIBILITY.get(r.source, 0.5)
        citations = min(1.0, (r.extra.get("citation_count", 0) or 0) / 200)
        year      = r.extra.get("year") or r.extra.get("published", "")
        recency   = 0.0
        if year:
            try:
                age   = max(0, 2025 - int(str(year)[:4]))
                recency = math.exp(-age / 5.0)
            except Exception:
                pass
        final = r.score * 0.40 + cred * 0.35 + citations * 0.15 + recency * 0.10
        ranked.append((r, final))

    ranked.sort(key=lambda x: x[1], reverse=True)
    top = [r for r, _ in ranked[:top_k]]

    logger.info(
        "Reranked %d → top %d results (credibility fallback)",
        len(results), len(top),
    )
    return top


# ─────────────────────────────────────────────────────────────────────────────
# Trafilatura full-crawl
# ─────────────────────────────────────────────────────────────────────────────

