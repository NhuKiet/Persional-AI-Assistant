"""tools/reranker.py — Rerank tùy chọn (tiered) + credibility + score fusion.

Backend: Cohere (nếu COHERE_API_KEY) → BGE local (nếu load được) → None.
Nơi DUY NHẤT load BGE reranker và giữ bảng credibility (searchers.py trỏ về đây).
fuse_scores / credibility_for là hàm thuần — test không cần model.
"""
from __future__ import annotations

import logging
import threading

from backend.app.core.config import settings

logger = logging.getLogger(__name__)

# ── Credibility theo nguồn — canonical DUY NHẤT ──────────────────────────────
_CREDIBILITY: dict[str, float] = {
    "arxiv":            1.0,
    "semantic_scholar": 0.95,
    "openalex":         0.90,
    "huggingface":      0.80,
    "wikipedia":        0.75,
    "github":           0.65,
    "web":              0.55,
}


def credibility_for(source: str) -> float:
    return _CREDIBILITY.get(source, 0.5)


# ── BGE reranker (lazy singleton) — nơi load DUY NHẤT ────────────────────────
_bge = None
_bge_lock = threading.Lock()
_bge_tried = False


def _bge_reranker():
    """FlagReranker instance hoặc None. Chỉ thử load MỘT lần (tránh retry storm)."""
    global _bge, _bge_tried
    if _bge is not None or _bge_tried:
        return _bge
    with _bge_lock:
        if _bge is not None or _bge_tried:
            return _bge
        _bge_tried = True
        try:
            import torch
            from FlagEmbedding import FlagReranker
            use_cuda = torch.cuda.is_available()
            logger.info("Loading reranker: %s (GPU=%s)", settings.RERANKER_MODEL, use_cuda)
            _bge = FlagReranker(settings.RERANKER_MODEL, use_fp16=use_cuda, use_cuda=use_cuda)
            logger.info("Reranker loaded on %s", "GPU" if use_cuda else "CPU")
        except Exception as e:
            logger.warning("BGE reranker load failed (non-fatal): %s", e)
            _bge = None
    return _bge


# ── Backends ─────────────────────────────────────────────────────────────────

def _cohere_remap(results, n: int) -> list[float]:
    """Map Cohere's `.results` (each with `.index`, `.relevance_score`, possibly
    shuffled/reordered by relevance) back to a list aligned with the original
    input-document order.
    """
    scores = [0.0] * n
    for r in results:
        scores[r.index] = float(r.relevance_score)
    return scores


def _cohere_scores(query: str, docs: list[str]) -> list[float] | None:
    if not settings.COHERE_API_KEY:
        return None
    try:
        import cohere
        client = cohere.ClientV2(api_key=settings.COHERE_API_KEY)
        resp = client.rerank(
            model="rerank-v3.5", query=query, documents=docs, top_n=len(docs),
        )
        return _cohere_remap(resp.results, len(docs))
    except Exception as e:
        logger.warning("Cohere rerank failed (non-fatal): %s", e)
        return None


def _bge_scores(query: str, docs: list[str]) -> list[float] | None:
    model = _bge_reranker()
    if model is None:
        return None
    try:
        raw = model.compute_score([(query, d) for d in docs], normalize=True)
        if isinstance(raw, (int, float)):
            raw = [raw]
        return [float(x) for x in raw]
    except Exception as e:
        logger.warning("BGE rerank failed (non-fatal): %s", e)
        return None


def cross_encoder_scores(query: str, docs: list[str]) -> list[float] | None:
    """Điểm liên quan [0,1] cho từng doc, hoặc None nếu không có backend nào."""
    if not docs:
        return None
    return _cohere_scores(query, docs) or _bge_scores(query, docs)


# ── Score fusion (pure) ──────────────────────────────────────────────────────

def fuse_scores(
    rerank: list[float] | None,
    base:   list[float],
    cred:   list[float],
) -> list[float]:
    out: list[float] = []
    for i in range(len(base)):
        if rerank is not None:
            out.append(rerank[i] * 0.7 + cred[i] * 0.2 + base[i] * 0.1)
        else:
            out.append(base[i] * 0.7 + cred[i] * 0.3)
    return out
