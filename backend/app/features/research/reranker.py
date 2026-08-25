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
    "huggingface":      0.80,
    "stackoverflow":    0.70,
    "web":              0.55,
    "duckduckgo":       0.50,
}


def credibility_for(source: str) -> float:
    return _CREDIBILITY.get(source, 0.5)


# ── BGE reranker (lazy singleton) — nơi load DUY NHẤT ────────────────────────
_bge = None
_bge_lock = threading.Lock()
_bge_tried = False


def _bge_reranker():
    """CrossEncoder instance hoặc None. Chỉ thử load MỘT lần (tránh retry storm).

    Dùng sentence-transformers thay vì FlagEmbedding: FlagEmbedding 1.4.0 gọi
    `prepare_for_model`, thứ transformers 5.x đã bỏ khỏi API tokenizer chậm.
    Model vẫn LOAD được, nên `_bge_reranker()` trả về một object trông bình
    thường — chỉ `compute_score` mới ném lỗi, và lỗi đó bị nuốt thành
    "fallback về credibility". Kết quả: rerank bằng cross-encoder chưa từng
    chạy lần nào mà không ai biết. CrossEncoder nạp đúng model đó qua đường
    tokenizer nhanh.
    """
    global _bge, _bge_tried
    if _bge is not None or _bge_tried:
        return _bge
    with _bge_lock:
        if _bge is not None or _bge_tried:
            return _bge
        _bge_tried = True
        try:
            import torch
            from sentence_transformers import CrossEncoder
            use_cuda = torch.cuda.is_available()
            logger.info("Loading reranker: %s (GPU=%s)", settings.RERANKER_MODEL, use_cuda)
            _bge = CrossEncoder(
                settings.RERANKER_MODEL,
                max_length=512,
                device="cuda" if use_cuda else "cpu",
            )
            logger.info("Reranker loaded on %s", "GPU" if use_cuda else "CPU")
        except Exception as e:
            logger.warning("BGE reranker load failed (non-fatal): %s", e)
            _bge = None
    return _bge


def reranker_selfcheck() -> str | None:
    """Chấm thử một cặp để biết đường rerank có THỰC SỰ chạy không.

    Trả None nếu ổn, chuỗi mô tả lỗi nếu không. Tồn tại vì việc chỉ load model
    lúc khởi động không đủ: lần hỏng vừa rồi load thành công và chỉ chết ở bước
    chấm điểm, nên hệ thống âm thầm chạy bằng credibility scoring vô thời hạn.
    Một cặp thật ở lúc boot biến hỏng-âm-thầm thành hỏng-có-tiếng.
    """
    model = _bge_reranker()
    if model is None:
        return "reranker model unavailable"
    try:
        scores = model.predict([("healthcheck query", "healthcheck document")])
        float(scores[0])
        return None
    except Exception as e:  # noqa: BLE001
        return f"{type(e).__name__}: {e}"


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
        raw = model.predict([(query, d) for d in docs])
        if isinstance(raw, (int, float)):
            raw = [raw]
        # CrossEncoder already applies sigmoid for single-logit models, so
        # these are relevance probabilities in [0, 1] — squashing them again
        # would flatten every score toward 0.5 and destroy the ranking.
        return [min(1.0, max(0.0, float(x))) for x in raw]
    except Exception as e:
        logger.warning("BGE rerank failed (non-fatal): %s", e)
        return None


def cross_encoder_scores(query: str, docs: list[str]) -> list[float] | None:
    """Điểm liên quan [0,1] cho từng doc, hoặc None nếu không có backend nào."""
    if not docs:
        return None
    return _cohere_scores(query, docs) or _bge_scores(query, docs)


# ── Score fusion (pure) ──────────────────────────────────────────────────────

# Weight sets, previously duplicated with different numbers in
# search/ranking.py. Neither call site's effective scoring changes — only
# where the reranker score comes from (ranking.py now uses the Cohere → BGE
# ladder instead of BGE alone).
_W_5           = {"rerank": 0.55, "cred": 0.20, "recency": 0.10, "citation": 0.10, "base": 0.05}
_W_5_NO_RERANK = {"base": 0.40, "cred": 0.35, "citation": 0.15, "recency": 0.10}
_W_3           = {"rerank": 0.70, "cred": 0.20, "base": 0.10}
_W_3_NO_RERANK = {"base": 0.70, "cred": 0.30}


def fuse_scores(
    rerank:   list[float] | None,
    base:     list[float],
    cred:     list[float],
    recency:  list[float] | None = None,
    citation: list[float] | None = None,
) -> list[float]:
    """Blend relevance signals into one score per document.

    Five-signal blend when recency/citation are supplied (live search results
    carry publication dates and citation counts), three-signal otherwise
    (stored chunks do not).
    """
    rich = recency is not None and citation is not None
    out: list[float] = []
    for i in range(len(base)):
        if rich and rerank is not None:
            w = _W_5
            out.append(
                rerank[i] * w["rerank"] + cred[i] * w["cred"]
                + recency[i] * w["recency"] + citation[i] * w["citation"]
                + base[i] * w["base"]
            )
        elif rich:
            w = _W_5_NO_RERANK
            out.append(
                base[i] * w["base"] + cred[i] * w["cred"]
                + citation[i] * w["citation"] + recency[i] * w["recency"]
            )
        elif rerank is not None:
            w = _W_3
            # Order matters for float exactness: rerank+base+cred lands on
            # exactly 1.0 for the all-ones case, rerank+cred+base does not
            # (0.9999999999999999) — see test_fuse_scores_three_signal_weights.
            out.append(rerank[i] * w["rerank"] + base[i] * w["base"] + cred[i] * w["cred"])
        else:
            w = _W_3_NO_RERANK
            out.append(base[i] * w["base"] + cred[i] * w["cred"])
    return out
