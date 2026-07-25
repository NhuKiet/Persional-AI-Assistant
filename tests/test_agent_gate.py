import backend.app.features.research.agent as agent_mod
from backend.app.features.research.models import ResearchOutput, SearchResult


def _sr(title="t", content="transformer attention mechanism", **extra):
    return SearchResult(source="web", title=title, url=f"u/{title}",
                        content=content, extra=extra)


def _decisions(events):
    return [e for e in events if e.get("type") == "knowledge_decision"]


def _run(monkeypatch, candidates, judge_verdict=(True, None), topup_new=None):
    """Chạy run_streaming với mọi I/O đã bị chặn."""
    from concurrent.futures import ThreadPoolExecutor
    from backend.app.features.research.agent import ResearchAgent

    a = ResearchAgent.__new__(ResearchAgent)
    a._pool = ThreadPoolExecutor(max_workers=2)

    class _Store:
        def retrieve_candidates(self, q, top_k=None): return candidates
        def retrieve(self, q): return candidates
        def add_results(self, q, s): return len(s)

    monkeypatch.setattr(agent_mod, "get_store", lambda: _Store())
    monkeypatch.setattr(a, "_run_judge", lambda *args: judge_verdict, raising=False)
    monkeypatch.setattr(a, "_top_up",
                        lambda q, base, gap: (base + (topup_new or []), topup_new or []),
                        raising=False)
    monkeypatch.setattr(a, "_search_all", lambda *args, **kw: [_sr("live")], raising=False)
    monkeypatch.setattr(a, "_process_pipeline", lambda q, r, **kw: r, raising=False)
    monkeypatch.setattr(agent_mod, "expand_query", lambda q, **kw: [q])
    monkeypatch.setattr(agent_mod, "needs_iteration", lambda *args, **kw: False)

    class _Synth:
        def synthesize_rag_grounded(self, q, s): return ResearchOutput(query=q)
        def synthesize_grounded(self, q, s):     return ResearchOutput(query=q)

    a.synth = _Synth()
    return list(a.run_streaming("transformer attention"))


def test_reuse_emits_sufficient_decision(monkeypatch):
    events = _run(monkeypatch, [_sr(stored_at=__import__("time").time())])
    d = _decisions(events)
    assert len(d) == 1
    assert d[0]["decision"] == "reuse"
    assert d[0]["reason"] == "sufficient"
    assert d[0]["new_count"] == 0


def test_insufficient_emits_top_up_decision(monkeypatch):
    events = _run(monkeypatch, [_sr(stored_at=__import__("time").time())],
                  judge_verdict=(False, "số liệu FLOPs"), topup_new=[_sr("mới")])
    d = _decisions(events)
    assert d[0]["decision"] == "top_up"
    assert d[0]["reason"] == "insufficient"
    assert d[0]["new_count"] == 1


def test_empty_candidates_emits_search_empty(monkeypatch):
    events = _run(monkeypatch, [])
    d = _decisions(events)
    assert d[0]["decision"] == "search"
    assert d[0]["reason"] == "empty"
    assert d[0]["stored_count"] == 0
    assert d[0]["fresh_count"] == 0


def test_stale_emits_search_stale(monkeypatch):
    old = _sr(stored_at=__import__("time").time() - 400 * 86400)
    events = _run(monkeypatch, [old])
    d = _decisions(events)
    assert d[0]["decision"] == "search"
    assert d[0]["reason"] == "stale"
    assert d[0]["fresh_count"] == 0


def test_top_up_failure_emits_degraded(monkeypatch):
    events = _run(monkeypatch, [_sr(stored_at=__import__("time").time())],
                  judge_verdict=(False, "thiếu"), topup_new=[])
    d = _decisions(events)
    assert d[0]["decision"] == "degraded"
    assert d[0]["reason"] == "top_up_failed"


def test_decision_precedes_synthesizing(monkeypatch):
    events = _run(monkeypatch, [_sr(stored_at=__import__("time").time())])
    types = [e["type"] for e in events]
    assert types.index("knowledge_decision") < types.index("synthesizing")


def test_fresh_count_never_exceeds_stored_count(monkeypatch):
    events = _run(monkeypatch, [_sr(stored_at=__import__("time").time())])
    d = _decisions(events)[0]
    assert d["fresh_count"] <= d["stored_count"]


def test_kill_switch_uses_legacy_retrieve_and_reuses(monkeypatch):
    """RESEARCH_SUFFICIENCY_ENABLED=False → không assess, không judge, cứ có
    kết quả là dùng — đúng hành vi cũ."""
    from backend.app.core.config import settings

    monkeypatch.setattr(settings, "RESEARCH_SUFFICIENCY_ENABLED", False)
    judged = []
    old = _sr(stored_at=__import__("time").time() - 400 * 86400)   # cũ mèm

    from concurrent.futures import ThreadPoolExecutor
    from backend.app.features.research.agent import ResearchAgent

    a = ResearchAgent.__new__(ResearchAgent)
    a._pool = ThreadPoolExecutor(max_workers=2)

    class _Store:
        def retrieve_candidates(self, q, top_k=None):
            raise AssertionError("kill switch phải dùng retrieve() legacy")
        def retrieve(self, q): return [old]
        def add_results(self, q, s): return len(s)

    monkeypatch.setattr(agent_mod, "get_store", lambda: _Store())
    monkeypatch.setattr(a, "_run_judge",
                        lambda *args: judged.append(1) or (True, None), raising=False)
    monkeypatch.setattr(agent_mod, "needs_iteration", lambda *a_, **k: False)

    class _Synth:
        def synthesize_rag_grounded(self, q, s): return ResearchOutput(query=q)
        def synthesize_grounded(self, q, s):     return ResearchOutput(query=q)

    a.synth = _Synth()
    events = list(a.run_streaming("transformer attention"))

    assert judged == []                                   # không gọi judge
    assert _decisions(events)[0]["decision"] == "reuse"    # dùng lại dù đã cũ
