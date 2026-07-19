"""backend/app/features/research/search/ranking.py — rerank ket qua search + trong so credibility.

BGE reranker KHONG load o day: uy quyen ve backend/app/features/research/reranker.py, noi load duy nhat.
"""
import logging
import math
from datetime import datetime, timezone

from backend.app.features.research.models import SearchResult
from backend.app.features.research.reranker import _bge_reranker, _CREDIBILITY

logger = logging.getLogger(__name__)


def recency_score(extra: dict, ref_year: int | None = None) -> float:
    """Pure scoring function for recency using exponential decay.

    Args:
        extra: dict with optional 'year' or 'published' fields
        ref_year: reference year for age calculation. Defaults to the
            current UTC year (`datetime.now(timezone.utc).year`) — a fixed
            year would drift stale as time passes and eventually penalize
            genuinely current sources.

    Returns:
        float in [0.0, 1.0]: exp(-age/5) where age = max(0, ref_year - year).
        Returns 0.0 if year is missing or unparseable.
    """
    if ref_year is None:
        ref_year = datetime.now(timezone.utc).year
    # A falsy-but-present "year" (0 or "") intentionally falls through to "published".
    year = extra.get("year") or extra.get("published", "")
    if not year:
        return 0.0
    try:
        age = max(0, ref_year - int(str(year)[:4]))
        return math.exp(-age / 5.0)
    except (ValueError, TypeError):
        return 0.0


def citation_score(extra: dict) -> float:
    """Pure scoring function for citation count with cap at 1.0.

    Args:
        extra: dict with optional 'citation_count' field

    Returns:
        float in [0.0, 1.0]: min(1.0, citation_count / 200).
        Returns 0.0 if citation_count is missing or 0.
    """
    return min(1.0, (extra.get("citation_count", 0) or 0) / 200)


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
                # Weighted combination: reranker 55%, credibility 20%, recency 10%, citation 10%, original score 5%
                final  = (
                    rerank_score * 0.55
                    + cred * 0.20
                    + recency_score(result.extra) * 0.10
                    + citation_score(result.extra) * 0.10
                    + result.score * 0.05
                )
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
        cred = _CREDIBILITY.get(r.source, 0.5)
        final = (
            r.score * 0.40
            + cred * 0.35
            + citation_score(r.extra) * 0.15
            + recency_score(r.extra) * 0.10
        )
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

