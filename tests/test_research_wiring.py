import types

from fastapi import FastAPI
from fastapi.testclient import TestClient

import backend.app.features.research.agent as ra_mod
import backend.app.features.research.router as research_router
import backend.app.shared.conversation_store as conv_mod
from tests.fake_session_store import FakeSessionStore


def test_run_streaming_done_includes_grounding_keys(monkeypatch):
    """done.data phải chứa claims/confidence/limitations (grounded synth).

    Điều chỉnh so với bản trong task-5-brief.md: run_streaming không gọi qua
    self._search_all/self._process_pipeline cho nhánh live-search — nó tự
    inline vòng lặp search trên self.<attr>.search(...) rồi gọi thẳng
    _enrich_web_results/deduplicate_results/rerank_results (tên module-level
    trong agent.py). Test này patch đúng những gì run_streaming thực sự dùng
    để đi trọn nhánh search thật, thay vì patch các method không được gọi.
    """
    import backend.app.features.research.agent as ra
    from backend.app.features.research.models import ResearchOutput, Claim, SearchResult

    from concurrent.futures import ThreadPoolExecutor

    agent = ra.ResearchAgent.__new__(ra.ResearchAgent)  # tránh __init__ nặng
    agent._pool = ThreadPoolExecutor(max_workers=2)

    class _Synth:
        def synthesize_grounded(self, q, s):
            o = ResearchOutput(query=q)
            o.claims = [Claim(text="c", source_ids=["x"], grounded=True)]
            o.confidence = 0.5
            o.limitations = ["ít nguồn"]
            return o

        def synthesize(self, q, s):
            return self.synthesize_grounded(q, s)

    agent.synth = _Synth()

    class _FakeSearcher:
        def __init__(self, name):
            self._name = name

        def search(self, query, k):
            if self._name == "web":
                return [SearchResult(source="web", title="t", url="u", content="x")]
            return []

    for name, attr, _ in ra_mod._SOURCES:
        setattr(agent, attr, _FakeSearcher(name))

    # tắt knowledge / query expansion / dynamic k
    monkeypatch.setattr(ra_mod, "get_store", lambda: type(
        "K", (), {"retrieve": lambda self, q: [], "add_results": lambda self, q, s: 0},
    )())
    monkeypatch.setattr(ra_mod, "expand_query", lambda q, **_kw: [q])
    monkeypatch.setattr(ra_mod, "get_dynamic_k", lambda q: {})

    # nhánh pipeline sau search — giữ nguyên danh sách để không cần logic thật
    monkeypatch.setattr(ra_mod, "_enrich_web_results", lambda raw: raw)
    monkeypatch.setattr(ra_mod, "deduplicate_results", lambda results, threshold=0.92: results)
    monkeypatch.setattr(ra_mod, "rerank_results", lambda query, results, top_k=15: results)

    events = list(agent.run_streaming("q"))
    done = [e for e in events if e.get("type") == "done"]
    assert done, f"no done event; events={events}"
    assert {"claims", "confidence", "limitations"} <= set(done[0]["data"])
    assert done[0]["data"]["claims"] == [
        {"text": "c", "source_ids": ["x"], "evidence_type": "uncertain"}
    ]
    assert done[0]["data"]["confidence"] == 0.5
    assert done[0]["data"]["limitations"] == ["ít nguồn"]


def test_run_streaming_accepts_provider(monkeypatch):
    """run_streaming phải nhận provider/model và tạo Synthesizer tương ứng."""
    seen = {}

    class FakeSynth:
        def __init__(self, llm=None):
            seen["built"] = True

        def synthesize(self, query, sources):
            raise RuntimeError("stop-after-build")

    # Ép nhánh search (không knowledge) và chặn sớm để chỉ kiểm tra khởi tạo synth
    monkeypatch.setattr(ra_mod, "Synthesizer", FakeSynth)

    agent = ra_mod.ResearchAgent()
    gen = agent.run_streaming("test query", provider="anthropic", model="claude-sonnet-5")
    events = list(gen)
    # Phải chạy tới lúc build synth theo model chọn và phát ra event error (do stop)
    assert seen.get("built") is True
    assert any(e.get("type") == "error" for e in events)

def test_search_shares_single_bge_singleton(monkeypatch):
    """search KHÔNG được tự load BGE — phải đi qua singleton của reranker.py.

    Sau task 4, ranking.py không còn giữ hàm `_get_reranker` riêng: nó gọi
    thẳng `cross_encoder_scores` (nơi DUY NHẤT chạm reranker model) từ
    reranker.py. Patch `_bge_reranker` ở reranker.py và xác nhận
    `cross_encoder_scores` (không có Cohere key) trả đúng điểm từ sentinel đó.
    """
    import backend.app.features.research.reranker as rr
    import backend.app.features.research.search as s

    monkeypatch.setattr(rr.settings, "COHERE_API_KEY", None, raising=False)
    monkeypatch.setattr(rr, "_bge_reranker", lambda: types.SimpleNamespace(
        compute_score=lambda pairs, normalize=True: [0.42] * len(pairs)
    ))

    assert rr.cross_encoder_scores("q", ["d"]) == [0.42]  # đi qua đúng nguồn duy nhất
    assert s._CREDIBILITY is rr._CREDIBILITY               # một nguồn sự thật cho credibility


def test_arxiv_searcher_parses_results_without_nameerror(monkeypatch):
    """F1 regression: ArxivSearcher không được NameError trên _ascii_query.

    Trước fix: _ascii_query chưa import → NameError ở dòng đầu try → except
    nuốt → search() trả []. Test này monkeypatch arxiv client để trả 1 paper
    giả; nếu search() trả rỗng nghĩa là bug còn.
    """
    import backend.app.features.research.search.academic as academic

    class _FakePub:
        year = 2024
        @staticmethod
        def date():
            return "2024-01-01"

    class _FakePaper:
        title = "Fake Neural Net Paper"
        entry_id = "http://arxiv.org/abs/1234.5678v1"
        summary = "A" * 50
        pdf_url = "http://arxiv.org/pdf/1234.5678v1"
        authors = ["Alice", "Bob"]
        categories = ["cs.LG", "cs.AI"]
        published = _FakePub()

    class _FakeClient:
        def __init__(self, *a, **k):
            pass
        def results(self, search):
            return iter([_FakePaper()])

    # Search thật chỉ lưu tham số (offline); vẫn patch cho chắc chắn không chạm mạng.
    monkeypatch.setattr(academic.arxiv, "Search", lambda **kw: object())
    monkeypatch.setattr(academic.arxiv, "Client", _FakeClient)

    results = academic.ArxivSearcher().search("neural networks", k=1)

    assert len(results) == 1
    r = results[0]
    assert r.source == "arxiv"
    assert r.title == "Fake Neural Net Paper"
    assert r.extra["arxiv_id"] == "1234.5678v1"
    assert r.extra["year"] == 2024


def test_run_streaming_iterates_once_when_first_result_weak(monkeypatch):
    """Grounding yếu ở vòng 1 → đúng 1 vòng bù (cap=1) rồi dừng; phát 'iteration'."""
    import backend.app.features.research.agent as ra
    from backend.app.features.research.models import ResearchOutput, Claim, SearchResult
    import backend.app.core.config as cfg
    monkeypatch.setattr(cfg.settings, "RESEARCH_MAX_ITERATIONS", 1, raising=False)

    agent = ra.ResearchAgent.__new__(ra.ResearchAgent)

    calls = {"synth": 0, "search_rounds": 0}

    class _Synth:
        def synthesize_grounded(self, q, s):
            calls["synth"] += 1
            o = ResearchOutput(query=q)
            if calls["synth"] == 1:      # vòng 1: yếu (ít claim, confidence thấp)
                o.claims = []
                o.confidence = 0.2
                o.follow_up_questions = ["deeper aspect?"]
            else:                        # vòng bù: mạnh
                o.claims = [Claim(text="c", source_ids=["x"], grounded=True) for _ in range(4)]
                o.confidence = 0.8
            return o
        def synthesize_rag(self, q, s): return ResearchOutput(query=q)
    agent.synth = _Synth()

    def _fake_search_all(q, *a, **k):
        calls["search_rounds"] += 1
        return [SearchResult(source="web", title="t", url=f"u{calls['search_rounds']}", content="x")]
    monkeypatch.setattr(agent, "_search_all", _fake_search_all)
    monkeypatch.setattr(agent, "_process_pipeline", lambda q, raw, **k: raw)

    # tắt knowledge + search inline của run_streaming
    monkeypatch.setattr(ra, "get_store", lambda: type("K", (), {
        "retrieve": lambda self, q: [], "add_results": lambda self, q, s: 0})())
    monkeypatch.setattr(ra, "expand_query", lambda q, **_kw: [q])
    monkeypatch.setattr(ra, "get_dynamic_k", lambda q: {})
    monkeypatch.setattr(ra, "_enrich_web_results", lambda r: r)
    monkeypatch.setattr(ra, "deduplicate_results", lambda r, threshold=0.92: r)
    monkeypatch.setattr(ra, "rerank_results", lambda q, r, top_k=15: r)
    # ép các searcher inline trả rỗng để vòng 1 dùng nguồn tối thiểu
    for attr in ("web", "arxiv", "semantic", "hf", "ddg", "so"):
        setattr(agent, attr, type("S", (), {"search": lambda self, q, k=4: []})())

    events = list(agent.run_streaming("q"))
    iters = [e for e in events if e.get("type") == "iteration"]
    done = [e for e in events if e.get("type") == "done"]
    assert len(iters) == 1                       # đúng 1 vòng bù
    assert calls["synth"] == 2                    # synth 2 lần (vòng 1 + bù)
    assert done and done[0]["data"]["confidence"] == 0.8   # dùng kết quả bù


def test_run_streaming_no_iteration_when_first_result_strong(monkeypatch):
    import backend.app.features.research.agent as ra
    from backend.app.features.research.models import ResearchOutput, Claim
    import backend.app.core.config as cfg
    monkeypatch.setattr(cfg.settings, "RESEARCH_MAX_ITERATIONS", 1, raising=False)
    agent = ra.ResearchAgent.__new__(ra.ResearchAgent)

    class _Synth:
        def synthesize_grounded(self, q, s):
            o = ResearchOutput(query=q)
            o.claims = [Claim(text="c", source_ids=["x"], grounded=True) for _ in range(5)]
            o.confidence = 0.9
            return o
        def synthesize_rag(self, q, s): return ResearchOutput(query=q)
    agent.synth = _Synth()
    agent._search_all = lambda q, *a, **k: []
    agent._process_pipeline = lambda q, raw, **k: raw
    monkeypatch.setattr(ra, "get_store", lambda: type("K", (), {
        "retrieve": lambda self, q: [], "add_results": lambda self, q, s: 0})())
    monkeypatch.setattr(ra, "expand_query", lambda q, **_kw: [q])
    monkeypatch.setattr(ra, "get_dynamic_k", lambda q: {})
    monkeypatch.setattr(ra, "_enrich_web_results", lambda r: r)
    monkeypatch.setattr(ra, "deduplicate_results", lambda r, threshold=0.92: r)
    monkeypatch.setattr(ra, "rerank_results", lambda q, r, top_k=15: r)
    for attr in ("web", "arxiv", "semantic", "hf", "ddg", "so"):
        setattr(agent, attr, type("S", (), {"search": lambda self, q, k=4: []})())

    events = list(agent.run_streaming("q"))
    assert [e for e in events if e.get("type") == "iteration"] == []


def test_rerank_fallback_prefers_more_recent(monkeypatch):
    """F2 regression: ở nhánh fallback (không BGE), paper mới hơn phải xếp trên.

    Trước fix: math chưa import → math.exp NameError bị nuốt → recency=0 cho
    cả hai → điểm bằng nhau → sort ổn định giữ nguyên thứ tự đầu vào (cũ đứng
    trước). Test đặt bản CŨ trước, bản MỚI sau; kỳ vọng sau fix bản MỚI lên đầu.
    """
    import backend.app.features.research.search.ranking as ranking
    from backend.app.features.research.models import SearchResult

    monkeypatch.setattr(ranking, "cross_encoder_scores", lambda q, docs: None)  # ép fallback

    old = SearchResult(source="web", title="old", url="u1", content="c",
                       score=0.5, extra={"year": 2000})
    new = SearchResult(source="web", title="new", url="u2", content="c",
                       score=0.5, extra={"year": 2024})

    ranked = ranking.rerank_results("q", [old, new], top_k=2)

    assert ranked[0].title == "new"


def test_run_streaming_stops_early_when_cancelled(monkeypatch):
    """cancel_event set sẵn → run_streaming dừng, phát 'cancelled', KHÔNG synthesize, KHÔNG done."""
    import threading
    import backend.app.features.research.agent as ra
    from backend.app.features.research.models import ResearchOutput, SearchResult

    agent = ra.ResearchAgent.__new__(ra.ResearchAgent)
    synth_called = {"n": 0}

    class _Synth:
        def synthesize_grounded(self, q, s):
            synth_called["n"] += 1
            return ResearchOutput(query=q)
        def synthesize_rag(self, q, s):
            synth_called["n"] += 1
            return ResearchOutput(query=q)
    agent.synth = _Synth()

    # tắt knowledge + search inline
    monkeypatch.setattr(ra, "get_store", lambda: type("K", (), {
        "retrieve": lambda self, q: [], "add_results": lambda self, q, s: 0})())
    monkeypatch.setattr(ra, "expand_query", lambda q, **_kw: [q])
    monkeypatch.setattr(ra, "get_dynamic_k", lambda q: {})
    monkeypatch.setattr(ra, "_enrich_web_results", lambda r: r)
    monkeypatch.setattr(ra, "deduplicate_results", lambda r, threshold=0.92: r)
    monkeypatch.setattr(ra, "rerank_results", lambda q, r, top_k=15: r)
    for attr in ("web", "arxiv", "semantic", "hf", "ddg", "so"):
        setattr(agent, attr, type("S", (), {"search": lambda self, q, k=4: []})())

    ev = threading.Event()
    ev.set()   # đã hủy trước khi chạy
    events = list(agent.run_streaming("q", cancel_event=ev))

    assert any(e.get("type") == "cancelled" for e in events)
    assert not any(e.get("type") == "done" for e in events)
    assert synth_called["n"] == 0


def test_run_streaming_normal_when_not_cancelled(monkeypatch):
    """Không truyền cancel_event → hành vi cũ (có 'done')."""
    import backend.app.features.research.agent as ra
    from backend.app.features.research.models import ResearchOutput
    agent = ra.ResearchAgent.__new__(ra.ResearchAgent)

    class _Synth:
        def synthesize_grounded(self, q, s):
            o = ResearchOutput(query=q); o.confidence = 0.9
            o.claims = []
            return o
        def synthesize_rag(self, q, s): return ResearchOutput(query=q)
    agent.synth = _Synth()
    agent._search_all = lambda q, *a, **k: []
    agent._process_pipeline = lambda q, raw, **k: raw
    monkeypatch.setattr(ra, "get_store", lambda: type("K", (), {
        "retrieve": lambda self, q: [], "add_results": lambda self, q, s: 0})())
    monkeypatch.setattr(ra, "expand_query", lambda q, **_kw: [q])
    monkeypatch.setattr(ra, "get_dynamic_k", lambda q: {})
    monkeypatch.setattr(ra, "_enrich_web_results", lambda r: r)
    monkeypatch.setattr(ra, "deduplicate_results", lambda r, threshold=0.92: r)
    monkeypatch.setattr(ra, "rerank_results", lambda q, r, top_k=15: r)
    for attr in ("web", "arxiv", "semantic", "hf", "ddg", "so"):
        setattr(agent, attr, type("S", (), {"search": lambda self, q, k=4: []})())

    events = list(agent.run_streaming("q"))
    assert any(e.get("type") == "done" for e in events)
    assert not any(e.get("type") == "cancelled" for e in events)


# ── History restore + concurrency lock (router-level) ───────────────────────

def _client():
    app = FastAPI()
    app.include_router(research_router.router)
    return TestClient(app)


def test_get_research_session_history_returns_expected_shape(monkeypatch, tmp_path):
    monkeypatch.setattr(conv_mod, "_store", FakeSessionStore())
    svc = research_router.get_service()
    svc._conv_manager.add_turn("hist-1", role="user", content="q")
    svc._conv_manager.add_turn("hist-1", role="assistant", content={"summary_short": "s"})

    r = _client().get("/api/research/sessions/hist-1")

    assert r.status_code == 200
    body = r.json()
    assert body == {
        "session_id": "hist-1",
        "feature": "research",
        "revision": 2,
        "messages": [
            {"role": "user", "content": "q"},
            {"role": "assistant", "content": {"summary_short": "s"}},
        ],
    }


def test_get_research_session_history_404_when_unknown(monkeypatch, tmp_path):
    monkeypatch.setattr(conv_mod, "_store", FakeSessionStore())
    r = _client().get("/api/research/sessions/never-existed")
    assert r.status_code == 404


def test_research_second_stream_while_active_returns_409():
    svc = research_router.get_service()
    lock = svc.begin_session("race-1")
    try:
        r = _client().post(
            "/api/research/stream",
            json={"query": "hi", "session_id": "race-1"},
        )
        assert r.status_code == 409
        assert r.json() == {"detail": "session_busy"}
    finally:
        svc.end_session(lock)


def test_research_deep_dive_while_stream_active_returns_409():
    svc = research_router.get_service()
    lock = svc.begin_session("race-2")
    try:
        r = _client().post(
            "/api/research/deep-dive",
            json={
                "question": "what?",
                "source_content": "src",
                "session_id": "race-2",
            },
        )
        assert r.status_code == 409
        assert r.json() == {"detail": "session_busy"}
    finally:
        svc.end_session(lock)
