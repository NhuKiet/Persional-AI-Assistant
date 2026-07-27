import backend.app.features.research.agent as agent_mod
from backend.app.features.research.models import ResearchOutput, SearchResult


def _sr(title="t", content="transformer attention mechanism", **extra):
    return SearchResult(source="web", title=title, url=f"u/{title}",
                        content=content, extra=extra)


def _run(monkeypatch, candidates, judge_verdict=(True, None), topup_new=None):
    from concurrent.futures import ThreadPoolExecutor
    from backend.app.features.research.agent import ResearchAgent

    stored = []
    a = ResearchAgent.__new__(ResearchAgent)
    a._pool = ThreadPoolExecutor(max_workers=2)

    class _Store:
        def retrieve_candidates(self, q, top_k=None): return candidates
        def retrieve(self, q): return candidates
        def add_results(self, q, s):
            stored.append(list(s))
            return len(s)

    monkeypatch.setattr(agent_mod, "get_store", lambda: _Store())
    monkeypatch.setattr(a, "_run_judge", lambda *args: judge_verdict, raising=False)
    monkeypatch.setattr(a, "_top_up",
                        lambda q, base, gap: (base + (topup_new or []), topup_new or []),
                        raising=False)
    monkeypatch.setattr(a, "_search_all", lambda *args, **kw: [_sr("live")], raising=False)
    monkeypatch.setattr(a, "_process_pipeline", lambda q, r, **kw: r, raising=False)

    # run_streaming's live-search branch (decision is None) calls the
    # per-source searchers directly (self.web, self.arxiv, …) rather than
    # going through _search_all — ResearchAgent.__new__() skips __init__,
    # so those attributes don't exist unless stubbed here.
    class _NullSearcher:
        def search(self, *a, **kw): return []

    class _WebSearcher:
        def search(self, *a, **kw): return [_sr("live")]

    a.web = _WebSearcher()
    a.arxiv = a.semantic = a.hf = a.ddg = a.so = _NullSearcher()

    monkeypatch.setattr(agent_mod, "expand_query", lambda q, **kw: [q])
    monkeypatch.setattr(agent_mod, "needs_iteration", lambda *args, **kw: False)
    monkeypatch.setattr(agent_mod, "deduplicate_results", lambda r, threshold=0.92: r)
    monkeypatch.setattr(agent_mod, "rerank_results", lambda q, r, top_k=15: r)
    monkeypatch.setattr(agent_mod, "_enrich_web_results", lambda r: r)

    class _Synth:
        def synthesize_rag_grounded(self, q, s): return ResearchOutput(query=q)
        def synthesize_grounded(self, q, s):     return ResearchOutput(query=q)

    a.synth = _Synth()
    list(a.run_streaming("transformer attention"))
    return stored


def test_reuse_stores_nothing(monkeypatch):
    """Nguồn đến từ DB đã nằm trong Weaviate — không ghi lại."""
    import time
    stored = _run(monkeypatch, [_sr(stored_at=time.time())])
    assert stored == [] or stored == [[]]


def test_top_up_stores_only_new_sources(monkeypatch):
    import time
    stored = _run(monkeypatch, [_sr("cũ", stored_at=time.time())],
                  judge_verdict=(False, "thiếu"), topup_new=[_sr("mới")])
    assert len(stored) == 1
    assert [s.title for s in stored[0]] == ["mới"]


def test_live_search_stores_once_not_twice(monkeypatch):
    """Hai call site cũ phải bị xoá — nếu còn, live search ghi hai lần."""
    stored = _run(monkeypatch, [])
    assert len(stored) == 1
