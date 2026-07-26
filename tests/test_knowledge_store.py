import time
import types

import backend.app.features.research.knowledge_store as ks
from backend.app.features.research.models import SearchResult
from backend.app.features.research.knowledge_store import _Hit, _rank_and_group, _objects_to_hits
from backend.app.features.research.knowledge_store import _apply_rerank_gate, _rerank
import backend.app.features.research.knowledge_store as ks_mod


def _sr(score, source="web", content="c"):
    return SearchResult(source=source, title="t", url="u", content=content, score=score)


def test_apply_rerank_gate_rejects_low_when_reranked():
    results = [_sr(0.3), _sr(0.2)]
    assert _apply_rerank_gate(results, rerank_used=True, threshold=0.5) == []


def test_apply_rerank_gate_keeps_high_when_reranked():
    results = [_sr(0.8), _sr(0.6)]
    out = _apply_rerank_gate(results, rerank_used=True, threshold=0.5)
    assert len(out) == 2


def test_apply_rerank_gate_no_rerank_keeps_all():
    results = [_sr(0.1)]
    # rerank_used=False → không double-gate dù điểm thấp
    assert _apply_rerank_gate(results, rerank_used=False, threshold=0.5) == results


def test_rerank_sorts_and_gates(monkeypatch):
    # mock cross_encoder_scores: doc thứ 2 liên quan hơn
    monkeypatch.setattr(ks_mod, "cross_encoder_scores", lambda q, docs: [0.1, 0.9])
    monkeypatch.setattr(ks_mod, "_RERANK_ENABLED", True)
    monkeypatch.setattr(ks_mod, "_RERANK_GATE", 0.5)
    monkeypatch.setattr(ks_mod, "_RERANK_CAND", 30)
    results = [_sr(0.5, content="a"), _sr(0.5, content="b")]
    out = _rerank("q", results)
    # b: 0.9*0.7 + 0.55*0.2 + 0.5*0.1 = 0.78 ; a: 0.1*0.7 + 0.55*0.2 + 0.5*0.1 = 0.23
    assert out[0].content == "b"
    # a (0.23) < gate 0.5 nhưng gate chỉ nhìn best → best=0.78 ≥ 0.5 → giữ cả list
    assert len(out) == 2


def test_rerank_gate_rejects_all_when_best_low(monkeypatch):
    monkeypatch.setattr(ks_mod, "cross_encoder_scores", lambda q, docs: [0.05, 0.02])
    monkeypatch.setattr(ks_mod, "_RERANK_ENABLED", True)
    monkeypatch.setattr(ks_mod, "_RERANK_GATE", 0.5)
    monkeypatch.setattr(ks_mod, "_RERANK_CAND", 30)
    results = [_sr(0.4, content="a"), _sr(0.4, content="b")]
    out = _rerank("q", results)
    # best final ~ 0.05*0.7+0.55*0.2+0.4*0.1 = 0.185 < 0.5 → []
    assert out == []


def test_rerank_degrades_gracefully_when_backend_raises(monkeypatch):
    def _boom(q, docs):
        raise RuntimeError("backend exploded")

    monkeypatch.setattr(ks_mod, "cross_encoder_scores", _boom)
    monkeypatch.setattr(ks_mod, "_RERANK_ENABLED", True)
    results = [_sr(0.6, content="a"), _sr(0.4, content="b")]
    out = _rerank("q", results)
    # no exception escapes; falls back to fused scores without rerank (rerank=None)
    assert out != []
    assert {r.content for r in out} == {"a", "b"}


def test_rerank_ignores_mismatched_length_rerank_scores(monkeypatch):
    # backend returns fewer scores than candidates -> should be nulled out, not IndexError
    monkeypatch.setattr(ks_mod, "cross_encoder_scores", lambda q, docs: [0.9])
    monkeypatch.setattr(ks_mod, "_RERANK_ENABLED", True)
    monkeypatch.setattr(ks_mod, "_RERANK_GATE", 0.5)
    results = [_sr(0.6, content="a"), _sr(0.4, content="b")]
    out = _rerank("q", results)
    assert out != []
    assert {r.content for r in out} == {"a", "b"}


def test_rank_and_group_dedups_by_parent():
    now = time.time()
    hits = [
        _Hit("p1", "parent one content", "arxiv", "T1", "u1", 0.9, now),
        _Hit("p1", "parent one content", "arxiv", "T1", "u1", 0.85, now),  # same parent
        _Hit("p2", "parent two content", "web", "T2", "u2", 0.8, now),
    ]
    out = _rank_and_group(hits, threshold=0.5, now=now)
    # p1 appears once, highest score first
    assert len(out) == 2
    assert out[0].content == "parent one content"
    assert out[0].score >= out[1].score


def test_rank_and_group_time_decay_filters_old(monkeypatch):
    now = time.time()
    old = now - 400 * 86400  # 400 days old → decayed far below threshold
    hits = [_Hit("p1", "c", "web", "T", "u", 0.9, old)]
    out = _rank_and_group(hits, threshold=0.65, now=now)
    assert out == []


def test_deduplicate_removes_near_duplicates(monkeypatch):
    # two near-identical results, one distinct
    r1 = SearchResult(source="web", title="A", url="u1", content="cats are nice", score=0.9)
    r2 = SearchResult(source="web", title="A2", url="u2", content="cats are nice", score=0.7)
    r3 = SearchResult(source="web", title="B", url="u3", content="dogs run fast", score=0.8)

    def fake_embed(texts):
        # identical vector for the cat texts, different for dog
        out = []
        for t in texts:
            out.append([1.0, 0.0] if "cats" in t else [0.0, 1.0])
        return out

    monkeypatch.setattr(ks, "embed_texts", fake_embed)
    out = ks.deduplicate_results([r1, r2, r3], threshold=0.92)
    # r1/r2 collapse to one (keep higher score r1), r3 stays
    assert len(out) == 2
    contents = {r.content for r in out}
    assert contents == {"cats are nice", "dogs run fast"}


def test_objects_to_hits_skips_malformed():
    now = time.time()

    valid_obj = types.SimpleNamespace(
        properties={
            "content":       "child chunk text",
            "parentContent": "parent section content",
            "source":        "arxiv",
            "title":         "T1",
            "url":           "u1",
            "timestamp":     now,
        },
        metadata=types.SimpleNamespace(score=0.77),
        uuid="valid-uuid-1",
    )

    malformed_obj = types.SimpleNamespace(
        properties={
            "content":       "other chunk",
            "parentContent": "other parent content",
            "source":        "web",
            "title":         "T2",
            "url":           "u2",
            "timestamp":     now,
        },
        metadata=None,  # obj.metadata.score will raise AttributeError
        uuid="malformed-uuid-2",
    )

    hits = _objects_to_hits([valid_obj, malformed_obj], now)

    assert len(hits) == 1
    assert hits[0].parent_content == "parent section content"


def test_objects_to_hits_flags_missing_timestamp_as_unknown():
    """Chunk cũ (lưu trước khi có property `timestamp`, hoặc bị thiếu vì lý
    do khác) không được coi là 'vừa lưu bây giờ' — `timestamp` vẫn fallback
    `now` để `_rank_and_group` (legacy) tính decay được, nhưng
    `timestamp_known` phải phản ánh đúng là property không hề tồn tại."""
    now = time.time()

    obj_without_timestamp = types.SimpleNamespace(
        properties={
            "content":       "child chunk text",
            "parentContent": "parent section content",
            "source":        "arxiv",
            "title":         "T1",
            "url":           "u1",
            # cố ý không có "timestamp"
        },
        metadata=types.SimpleNamespace(score=0.77),
        uuid="no-ts-uuid",
    )

    hits = _objects_to_hits([obj_without_timestamp], now)

    assert len(hits) == 1
    assert hits[0].timestamp == now          # fallback vẫn có giá trị hợp lệ
    assert hits[0].timestamp_known is False  # nhưng đánh dấu là KHÔNG rõ


def test_objects_to_hits_flags_present_timestamp_as_known():
    now = time.time()

    obj_with_timestamp = types.SimpleNamespace(
        properties={
            "content":       "child chunk text",
            "parentContent": "parent section content",
            "source":        "arxiv",
            "title":         "T1",
            "url":           "u1",
            "timestamp":     now - 3600,
        },
        metadata=types.SimpleNamespace(score=0.77),
        uuid="with-ts-uuid",
    )

    hits = _objects_to_hits([obj_with_timestamp], now)

    assert len(hits) == 1
    assert hits[0].timestamp == now - 3600
    assert hits[0].timestamp_known is True
