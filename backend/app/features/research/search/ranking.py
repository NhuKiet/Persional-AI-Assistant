"""backend/app/features/research/search/ranking.py — rerank ket qua search + trong so credibility.

BGE reranker KHONG load o day: uy quyen ve backend/app/features/research/reranker.py, noi load duy nhat.
"""
import logging
import math
from datetime import datetime, timezone

from backend.app.features.research.models import SearchResult
from backend.app.features.research.reranker import (
    _CREDIBILITY, cross_encoder_scores, fuse_scores,
)

logger = logging.getLogger(__name__)


def recency_score(extra: dict, ref_year: int | None = None) -> float:
    """Exponential-decay recency in [0, 1]: exp(-age/5), 0.0 when unknown.

    Accepts three shapes because the pipeline produces three: live academic
    results carry "year" or "published", while knowledge-store chunks carry
    "published_at" as an epoch (knowledge_store._rank_candidates). Reading
    only the first two meant every stored source scored 0.0 no matter how
    recent it was.
    """
    if ref_year is None:
        ref_year = datetime.now(timezone.utc).year

    # A falsy-but-present "year" (0 or "") intentionally falls through.
    year = extra.get("year") or extra.get("published", "")
    if not year:
        epoch = extra.get("published_at")
        if epoch:
            try:
                year = datetime.fromtimestamp(float(epoch), timezone.utc).year
            except (ValueError, TypeError, OSError, OverflowError):
                return 0.0
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


# ─────────────────────────────────────────────────────────────────────────────
# Query classifier → dynamic k
# ─────────────────────────────────────────────────────────────────────────────

def rerank_results(
    query:   str,
    results: list[SearchResult],
    top_k:   int = 15,
) -> list[SearchResult]:
    """Rerank with the shared cross-encoder ladder plus credibility, recency
    and citation signals. Falls back to the non-reranked blend when no
    reranker backend is available."""
    if not results:
        return results

    base     = [r.score for r in results]
    cred     = [_CREDIBILITY.get(r.source, 0.5) for r in results]
    recency  = [recency_score(r.extra) for r in results]
    citation = [citation_score(r.extra) for r in results]

    try:
        rerank = cross_encoder_scores(
            query, [f"{r.title} {r.content[:500]}" for r in results]
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("cross_encoder_scores failed (non-fatal): %s", e)
        rerank = None
    if rerank is not None and len(rerank) != len(results):
        logger.warning("Rerank length mismatch (%d vs %d) — ignoring rerank scores",
                       len(rerank), len(results))
        rerank = None

    final  = fuse_scores(rerank, base, cred, recency=recency, citation=citation)
    ranked = sorted(zip(results, final), key=lambda x: x[1], reverse=True)
    top    = [r for r, _ in ranked[:top_k]]
    logger.info(
        "Reranked %d → top %d results (%s)",
        len(results), len(top),
        "cross-encoder" if rerank is not None else "credibility fallback",
    )
    return top


# ─────────────────────────────────────────────────────────────────────────────
# Trafilatura full-crawl
# ─────────────────────────────────────────────────────────────────────────────

