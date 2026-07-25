import backend.app.features.research.agent as agent_mod
from backend.app.features.research.agent import ResearchAgent
from backend.app.features.research.models import SearchResult


def _sr(title, content="nội dung"):
    return SearchResult(source="web", title=title, url=f"https://e.com/{title}",
                        content=content)


def _agent(monkeypatch, extra_results):
    a = ResearchAgent.__new__(ResearchAgent)          # bỏ qua __init__ (mở socket)
    monkeypatch.setattr(a, "_search_all", lambda q: extra_results, raising=False)
    monkeypatch.setattr(a, "_process_pipeline", lambda q, r, **k: r, raising=False)
    monkeypatch.setattr(agent_mod, "deduplicate_results", lambda r, threshold=0.92: r)
    monkeypatch.setattr(agent_mod, "rerank_results", lambda q, r, top_k=15: r)
    return a


def test_top_up_returns_merged_and_new(monkeypatch):
    base = [_sr("cũ")]
    new  = [_sr("mới")]
    a = _agent(monkeypatch, new)

    merged, newly = a._top_up("q", base, "q thêm chi tiết")

    assert {s.title for s in merged} == {"cũ", "mới"}
    assert [s.title for s in newly] == ["mới"]


def test_top_up_excludes_base_sources_from_new(monkeypatch):
    """Nguồn lấy từ DB đã nằm trong Weaviate — không được ghi lại."""
    base = [_sr("cũ")]
    a = _agent(monkeypatch, [_sr("cũ")])          # search trả về trùng nguồn cũ

    merged, newly = a._top_up("q", base, "gap")

    assert newly == []


def test_top_up_new_dropped_by_dedup_is_not_returned(monkeypatch):
    base = [_sr("cũ")]
    a = _agent(monkeypatch, [_sr("mới")])
    # dedup loại nguồn mới → nó không được coi là newly fetched
    monkeypatch.setattr(agent_mod, "deduplicate_results",
                        lambda r, threshold=0.92: [s for s in r if s.title != "mới"])

    merged, newly = a._top_up("q", base, "gap")

    assert newly == []
    assert [s.title for s in merged] == ["cũ"]


def test_top_up_search_failure_returns_base_unchanged(monkeypatch):
    base = [_sr("cũ")]
    a = _agent(monkeypatch, [])

    def boom(q):
        raise RuntimeError("search down")

    monkeypatch.setattr(a, "_search_all", boom, raising=False)

    merged, newly = a._top_up("q", base, "gap")

    assert [s.title for s in merged] == ["cũ"]
    assert newly == []
