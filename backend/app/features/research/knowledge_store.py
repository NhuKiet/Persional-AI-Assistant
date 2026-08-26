"""backend/app/features/research/knowledge_store.py — Knowledge store dùng Weaviate Cloud + OpenAI embeddings.

Parent-child: search trên child (chunk nhỏ, có vector), trả nội dung parent (section).
Interface public giữ nguyên để research_agent không đổi.
"""
from __future__ import annotations

import datetime
import logging
import math
import threading
import time
from dataclasses import dataclass

from backend.app.core import capabilities
from backend.app.core.config import settings
from backend.app.features.research.models import SearchResult
from backend.app.features.research.chunking import build_parent_child, category_for
from backend.app.features.research.embeddings import embed_texts, embed_query
from backend.app.features.research.reranker import cross_encoder_scores, fuse_scores, credibility_for

logger = logging.getLogger(__name__)

_THRESHOLD    = settings.KNOWLEDGE_THRESHOLD
_CHUNK_SIZE   = settings.KNOWLEDGE_CHUNK_SIZE
_OVERLAP      = settings.KNOWLEDGE_OVERLAP
_TOP_K        = settings.KNOWLEDGE_TOP_K
_COLLECTION   = settings.WEAVIATE_COLLECTION
_CANDIDATE_THRESHOLD = settings.KNOWLEDGE_CANDIDATE_THRESHOLD

_RERANK_ENABLED = settings.RERANK_ENABLED
_RERANK_GATE    = settings.RERANK_GATE_THRESHOLD
_RERANK_CAND    = settings.RERANK_CANDIDATES


# ── Hit dataclass + pure ranking (testable, no I/O) ──────────────────────────

@dataclass
class _Hit:
    parent_id:       str
    parent_content:  str
    source:          str
    title:           str
    url:             str
    score:           float
    timestamp:       float
    published_at:    float = 0.0
    published_year:  int   = 0
    # True nếu Weaviate object thực sự có property "timestamp". False khi
    # thiếu và `timestamp` chỉ là giá trị fallback `now` — legacy `_rank_and_
    # group`/`retrieve()` vẫn cần MỘT con số hợp lệ để tính decay nên field
    # `timestamp` luôn được set, nhưng `_rank_candidates` (tầng sufficiency
    # mới) cần phân biệt được "mới thật" với "không rõ" để quy tắc bất đối
    # xứng volatile+unknown→STALE (spec §12.1) hoạt động trên dữ liệu thật.
    timestamp_known: bool = True


def _objects_to_hits(objects, now: float) -> list[_Hit]:
    """Convert Weaviate hybrid-query response objects into `_Hit`s.

    Each object is parsed independently; a malformed object (e.g. missing
    metadata or a non-numeric timestamp) is skipped rather than aborting the
    whole batch, since `retrieve()` is a cache and must never crash the
    research pipeline on bad data.
    """
    hits: list[_Hit] = []
    for obj in objects:
        try:
            p = obj.properties
            parent_content = p.get("parentContent") or p.get("content", "")
            hits.append(_Hit(
                parent_id       = parent_content or str(obj.uuid),
                parent_content  = parent_content,
                source          = p.get("source", "knowledge"),
                title           = p.get("title", ""),
                url             = p.get("url", ""),
                score           = float(obj.metadata.score or 0.0),
                timestamp       = float(p.get("timestamp", now)),
                timestamp_known = "timestamp" in p,
                published_at    = float(p.get("publishedAt") or 0.0),
                published_year  = int(p.get("publishedYear") or 0),
            ))
        except Exception as e:
            logger.debug("Skipping malformed Weaviate object: %s", e)
            continue
    return hits


def _rank_and_group(hits: list[_Hit], threshold: float, now: float) -> list[SearchResult]:
    """Time-decay rescore, lọc threshold, dedup theo parent_id, sort giảm dần."""
    best: dict[str, tuple[float, _Hit]] = {}
    for h in hits:
        age_days = (now - h.timestamp) / 86400.0
        d_score  = h.score * math.exp(-age_days / 60.0)
        if d_score < threshold:
            continue
        prev = best.get(h.parent_id)
        if prev is None or d_score > prev[0]:
            best[h.parent_id] = (d_score, h)

    results = [
        SearchResult(
            source  = h.source or "knowledge",
            title   = h.title  or h.parent_id,
            url     = h.url    or "",
            content = h.parent_content,
            score   = d_score,
        )
        for d_score, h in best.values()
    ]
    results.sort(key=lambda r: r.score, reverse=True)
    return results


def _rank_candidates(hits: list[_Hit], threshold: float, now: float) -> list[SearchResult]:
    """Như `_rank_and_group` nhưng lọc theo điểm THÔ, decay chỉ dùng để SẮP XẾP.

    `_rank_and_group` so ngưỡng với điểm ĐÃ decay, nên tuổi tác loại bỏ chứ
    không phải hạ hạng: chunk điểm 1.0 biến mất sau ~26 ngày, 0.8 sau ~12.5
    ngày. TTL 180 ngày cho câu hỏi stable vì thế không bao giờ chạy tới.
    Tách ra: liên quan lọc ở đây, độ mới lọc ở tầng sufficiency.
    """
    best: dict[str, tuple[float, _Hit]] = {}
    for h in hits:
        if h.score < threshold:
            continue
        prev = best.get(h.parent_id)
        if prev is None or h.score > prev[0]:
            best[h.parent_id] = (h.score, h)

    results: list[SearchResult] = []
    for raw_score, h in best.values():
        # `h.timestamp` luôn có giá trị (fallback `now` cho decay ordering ở
        # dưới) nhưng chỉ đưa vào `extra` khi property THẬT SỰ tồn tại —
        # nếu không, mọi chunk thiếu timestamp sẽ trông "vừa lưu bây giờ"
        # thay vì "không rõ tuổi", vô hiệu hoá quy tắc bất đối xứng ở
        # sufficiency.assess (spec §12.1).
        extra: dict = {}
        if h.timestamp_known:
            extra["stored_at"] = h.timestamp
        if h.published_at:
            extra["published_at"] = h.published_at
        elif h.published_year:
            extra["published_at"] = datetime.datetime(h.published_year, 1, 1).timestamp()

        age_days = (now - h.timestamp) / 86400.0
        results.append(SearchResult(
            source  = h.source or "knowledge",
            title   = h.title  or h.parent_id,
            url     = h.url    or "",
            content = h.parent_content,
            score   = raw_score,
            extra   = extra,
        ))
        results[-1].extra["_decayed"] = raw_score * math.exp(-age_days / 60.0)

    results.sort(key=lambda r: r.extra["_decayed"], reverse=True)
    for r in results:
        r.extra.pop("_decayed", None)
    return results


def _apply_rerank_gate(results, rerank_used: bool, threshold: float):
    """Chỉ siết ngưỡng khi CÓ reranker; giả định results đã sort giảm dần."""
    if rerank_used and (not results or results[0].score < threshold):
        return []
    return results


def published_epoch_from_extra(extra: dict | None) -> tuple[float, int]:
    """Rút ngày xuất bản từ SearchResult.extra.

    arxiv cho ngày đầy đủ ("published"), Semantic Scholar/OpenAlex chỉ cho
    năm. Trả (epoch, year); 0 nghĩa là không biết.
    """
    extra = extra or {}

    year = 0
    try:
        raw_year = extra.get("year")
        if raw_year is not None:
            year = int(raw_year)
    except (TypeError, ValueError):
        year = 0

    at = 0.0
    raw_date = extra.get("published")
    if raw_date:
        try:
            at = datetime.datetime.strptime(str(raw_date)[:10], "%Y-%m-%d").timestamp()
        except (TypeError, ValueError):
            at = 0.0

    return at, year


def _rerank(query: str, results: list[SearchResult]) -> list[SearchResult]:
    """Fuse rerank + credibility + base, sort giảm dần, rồi gate. Không I/O nếu rerank tắt."""
    candidates = results[:_RERANK_CAND]
    base = [r.score for r in candidates]
    cred = [credibility_for(r.source) for r in candidates]
    try:
        if _RERANK_ENABLED:
            rerank = cross_encoder_scores(query, [r.content[:1000] for r in candidates])
        else:
            capabilities.disabled(capabilities.RERANKER)
            rerank = None
    except Exception as e:
        logger.warning("cross_encoder_scores failed (non-fatal): %s", e)
        rerank = None
    if rerank is not None and len(rerank) != len(candidates):
        logger.warning("Rerank length mismatch (%d vs %d) — ignoring rerank scores",
                       len(rerank), len(candidates))
        rerank = None
    final = fuse_scores(rerank, base, cred)
    for r, f in zip(candidates, final):
        r.score = f
    candidates.sort(key=lambda r: r.score, reverse=True)
    return _apply_rerank_gate(candidates, rerank is not None, _RERANK_GATE)


# ── Weaviate client (lazy singleton) ─────────────────────────────────────────

_client = None
_client_lock = threading.Lock()


def _get_weaviate():
    global _client
    if _client is not None:
        return _client
    with _client_lock:
        if _client is not None:
            return _client
        if not settings.WEAVIATE_URL or not settings.WEAVIATE_API_KEY:
            raise RuntimeError("WEAVIATE_URL / WEAVIATE_API_KEY chưa cấu hình.")
        import weaviate
        from weaviate.classes.init import Auth
        try:
            client = weaviate.connect_to_weaviate_cloud(
                cluster_url=settings.WEAVIATE_URL,
                auth_credentials=Auth.api_key(settings.WEAVIATE_API_KEY),
            )
            _ensure_schema(client)
        except Exception as e:
            capabilities.failed(capabilities.KNOWLEDGE_STORE, f"{type(e).__name__}: {e}")
            raise
        _client = client
        logger.info("Weaviate connected: %s", settings.WEAVIATE_URL)
    return _client


_NEW_PROPERTIES = [("publishedAt", "NUMBER"), ("publishedYear", "INT")]


def _ensure_new_properties(client) -> None:
    """Collection đã tồn tại thì `_ensure_schema` return sớm, nên property
    mới thêm vào định nghĩa sẽ KHÔNG tới được collection đang chạy — phải
    add tường minh. Toàn bộ non-fatal: thiếu property thì code đọc đã có
    đường lui (published_at = None → rơi về stored_at).
    """
    import weaviate.classes.config as wc

    try:
        col = client.collections.get(_COLLECTION)
        existing = {p.name for p in col.config.get().properties}
    except Exception as e:  # noqa: BLE001
        logger.warning("Could not read collection config (non-fatal): %s", e)
        return

    for name, dtype in _NEW_PROPERTIES:
        if name in existing:
            continue
        try:
            col.config.add_property(
                wc.Property(name=name, data_type=getattr(wc.DataType, dtype))
            )
            logger.info("Weaviate: added property %s", name)
        except Exception as e:  # noqa: BLE001
            logger.warning("Could not add property %s (non-fatal): %s", name, e)


def _ensure_schema(client) -> None:
    import weaviate.classes.config as wc
    if client.collections.exists(_COLLECTION):
        _ensure_new_properties(client)
        return
    client.collections.create(
        name=_COLLECTION,
        vectorizer_config=wc.Configure.Vectorizer.none(),
        properties=[
            wc.Property(name="content",        data_type=wc.DataType.TEXT),
            wc.Property(name="sectionHeading", data_type=wc.DataType.TEXT),
            wc.Property(name="source",         data_type=wc.DataType.TEXT),
            wc.Property(name="sourceCategory", data_type=wc.DataType.TEXT),
            wc.Property(name="url",            data_type=wc.DataType.TEXT),
            wc.Property(name="title",          data_type=wc.DataType.TEXT),
            wc.Property(name="query",          data_type=wc.DataType.TEXT),
            wc.Property(name="timestamp",      data_type=wc.DataType.NUMBER),
            wc.Property(name="score",          data_type=wc.DataType.NUMBER),
            wc.Property(name="chunkIndex",     data_type=wc.DataType.INT),
            wc.Property(name="parentContent",  data_type=wc.DataType.TEXT),
            wc.Property(name="publishedAt",   data_type=wc.DataType.NUMBER),
            wc.Property(name="publishedYear", data_type=wc.DataType.INT),
        ],
    )
    logger.info("Weaviate schema created: %s", _COLLECTION)


# ── Deduplication (near-duplicate search results, before chunking) ───────────

def deduplicate_results(results: list[SearchResult], threshold: float = 0.92) -> list[SearchResult]:
    if len(results) <= 1:
        return results
    try:
        import numpy as np
        texts = [f"{r.title} {r.content[:300]}" for r in results]
        vecs = np.array(embed_texts(texts))
        norms = np.linalg.norm(vecs, axis=1, keepdims=True) + 1e-9
        vecs_n = vecs / norms

        kept: list[SearchResult] = []
        removed: set[int] = set()
        for i, result in enumerate(results):
            if i in removed:
                continue
            kept.append(result)
            for j in range(i + 1, len(results)):
                if j in removed:
                    continue
                sim = float(np.dot(vecs_n[i], vecs_n[j]))
                if sim >= threshold:
                    if results[j].score > kept[-1].score:
                        kept[-1] = results[j]
                    removed.add(j)
        logger.info("Deduplication: %d → %d results", len(results), len(kept))
        return kept
    except Exception as e:
        logger.warning("Deduplication failed (non-fatal): %s", e)
        return results


# ── KnowledgeStore ───────────────────────────────────────────────────────────

class KnowledgeStore:

    def add_results(self, query: str, results: list[SearchResult]) -> int:
        if not results:
            return 0
        try:
            client = _get_weaviate()
        except Exception as e:
            # Not attributed here: _get_weaviate already reports from its
            # own boundary, where the cause is unambiguous.
            logger.warning("KnowledgeStore add skipped (Weaviate unavailable): %s", e)
            return 0

        col = client.collections.get(_COLLECTION)

        from weaviate.classes.data import DataObject

        stored = 0
        for result in results:
            if not result.content or not result.content.strip():
                continue
            category = category_for(result.source)
            ts = time.time()
            published_at, published_year = published_epoch_from_extra(result.extra)
            objects: list = []
            for parent in build_parent_child(result.content, _CHUNK_SIZE, _OVERLAP):
                try:
                    child_vecs = embed_texts(parent.children)
                except Exception as e:
                    logger.warning("Embedding failed for a section: %s", e)
                    continue
                for idx, (chunk, vec) in enumerate(zip(parent.children, child_vecs)):
                    objects.append(DataObject(
                        properties={
                            "content":        chunk,
                            "sectionHeading": parent.heading,
                            "source":         result.source,
                            "sourceCategory": category,
                            "url":            result.url or "",
                            "title":          result.title or "",
                            "query":          query,
                            "timestamp":      ts,
                            "score":          result.score,
                            "chunkIndex":     idx,
                            "parentContent":  parent.content,
                            "publishedAt":    published_at,
                            "publishedYear":  published_year,
                        },
                        vector=vec,
                    ))

            if not objects:
                continue
            try:
                res = col.data.insert_many(objects)
                stored += len(objects) - len(res.errors)
            except Exception as e:
                logger.warning("Batch insert failed for a result (non-fatal): %s", e)

        logger.info("KnowledgeStore: stored %d chunks for: %s", stored, query[:60])
        return stored

    def retrieve(self, query: str, top_k: int = _TOP_K, threshold: float = _THRESHOLD) -> list[SearchResult]:
        try:
            client = _get_weaviate()
            q_vec = embed_query(query)
        except Exception as e:
            # Not attributed here: _get_weaviate and embed_query each report
            # from their own boundary, where the cause is unambiguous.
            logger.warning("KnowledgeStore retrieve skipped: %s", e)
            return []

        try:
            from weaviate.classes.query import HybridFusion, MetadataQuery
            col = client.collections.get(_COLLECTION)
            resp = col.query.hybrid(
                query=query,
                vector=q_vec,
                alpha=0.5,
                limit=top_k * 2,
                fusion_type=HybridFusion.RELATIVE_SCORE,
                query_properties=["content"],
                return_metadata=MetadataQuery(score=True),
            )
        except Exception as e:
            capabilities.failed(capabilities.KNOWLEDGE_STORE, f"{type(e).__name__}: {e}")
            logger.warning("Weaviate hybrid query failed (non-fatal): %s", e)
            return []
        capabilities.ok(capabilities.KNOWLEDGE_STORE)

        now = time.time()
        hits = _objects_to_hits(resp.objects, now)

        results = _rank_and_group(hits, threshold, now)
        if not results:
            logger.info("KnowledgeStore: no hits for: %s", query[:60])
            return []
        try:
            results = _rerank(query, results)
        except Exception as e:
            logger.warning("Rerank stage failed (non-fatal): %s", e)
            results = results[:top_k]
        logger.info("KnowledgeStore: retrieved %d sources for: %s", len(results), query[:60])
        return results[:top_k]

    def retrieve_candidates(self, query: str, top_k: int = _TOP_K) -> list[SearchResult]:
        """Ứng viên cho tầng sufficiency: lọc liên quan theo điểm thô, mang
        theo metadata độ mới. Không rerank-gate — gate đó dành cho `retrieve`
        legacy; ở đây tầng 1/2 mới là nơi quyết định."""
        try:
            client = _get_weaviate()
            q_vec  = embed_query(query)
        except Exception as e:
            # Not attributed here: _get_weaviate and embed_query each report
            # from their own boundary, where the cause is unambiguous.
            logger.warning("retrieve_candidates skipped: %s", e)
            return []

        try:
            from weaviate.classes.query import HybridFusion, MetadataQuery
            col  = client.collections.get(_COLLECTION)
            resp = col.query.hybrid(
                query=query, vector=q_vec, alpha=0.5, limit=top_k * 2,
                fusion_type=HybridFusion.RELATIVE_SCORE,
                query_properties=["content"],
                return_metadata=MetadataQuery(score=True),
            )
        except Exception as e:
            capabilities.failed(capabilities.KNOWLEDGE_STORE, f"{type(e).__name__}: {e}")
            logger.warning("Weaviate hybrid query failed (non-fatal): %s", e)
            return []
        capabilities.ok(capabilities.KNOWLEDGE_STORE)

        now  = time.time()
        hits = _objects_to_hits(resp.objects, now)
        out  = _rank_candidates(hits, _CANDIDATE_THRESHOLD, now)
        logger.info("retrieve_candidates: %d candidates for: %s", len(out), query[:60])
        return out[:top_k]

    def size(self) -> int:
        try:
            client = _get_weaviate()
            col = client.collections.get(_COLLECTION)
            total = col.aggregate.over_all(total_count=True).total_count or 0
        except Exception as e:
            # Unlike retrieve/retrieve_candidates, every call in this method is
            # a Weaviate call, so a failure here is unambiguously the store's.
            capabilities.failed(capabilities.KNOWLEDGE_STORE, f"{type(e).__name__}: {e}")
            logger.warning("KnowledgeStore.size() failed: %s", e)
            return 0
        capabilities.ok(capabilities.KNOWLEDGE_STORE)
        return total

    def clear(self) -> None:
        try:
            client = _get_weaviate()
            if client.collections.exists(_COLLECTION):
                client.collections.delete(_COLLECTION)
            _ensure_schema(client)
            logger.info("KnowledgeStore: cleared and recreated collection")
        except Exception as e:
            logger.error("KnowledgeStore.clear() failed: %s", e)


_store: KnowledgeStore | None = None
_store_lock = threading.Lock()


def get_store() -> KnowledgeStore:
    global _store
    if _store is not None:
        return _store
    with _store_lock:
        if _store is None:
            _store = KnowledgeStore()
    return _store
