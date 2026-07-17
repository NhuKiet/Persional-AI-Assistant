import backend.app.features.research.agent as ra_mod


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

    agent = ra.ResearchAgent.__new__(ra.ResearchAgent)  # tránh __init__ nặng

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
    monkeypatch.setattr(ra_mod, "expand_query", lambda q: [q])
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


def test_is_relevant_is_now_presence_check():
    from backend.app.features.research.agent import ResearchAgent
    from backend.app.features.research.models import SearchResult
    agent = ResearchAgent.__new__(ResearchAgent)  # không chạy __init__ (tránh tải searchers)
    assert agent._is_relevant("bất kỳ", [SearchResult(source="web", title="t", url="u", content="x")]) is True
    assert agent._is_relevant("bất kỳ", []) is False


def test_search_shares_single_bge_singleton(monkeypatch):
    """search KHÔNG được tự load BGE — phải đi qua singleton của reranker.py.

    Bản cũ khẳng định `_get_reranker.__module__ == "tools.searchers"`, tức chỉ
    kiểm hàm được định nghĩa ở đâu — không hề kiểm điều nó tuyên bố. Ở đây gọi
    thật và xem có đúng object mà reranker.py cấp không.
    """
    import backend.app.features.research.reranker as rr
    import backend.app.features.research.search as s

    sentinel = object()
    monkeypatch.setattr(rr, "_bge_reranker", lambda: sentinel)
    # ranking.py giữ tham chiếu riêng từ lúc import, nên patch cả nơi nó dùng
    import backend.app.features.research.search.ranking as ranking
    monkeypatch.setattr(ranking, "_bge_reranker", lambda: sentinel)

    assert s._get_reranker() is sentinel        # đi qua đúng nguồn duy nhất
    assert s._CREDIBILITY is rr._CREDIBILITY    # một nguồn sự thật cho credibility


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


def test_rerank_fallback_prefers_more_recent(monkeypatch):
    """F2 regression: ở nhánh fallback (không BGE), paper mới hơn phải xếp trên.

    Trước fix: math chưa import → math.exp NameError bị nuốt → recency=0 cho
    cả hai → điểm bằng nhau → sort ổn định giữ nguyên thứ tự đầu vào (cũ đứng
    trước). Test đặt bản CŨ trước, bản MỚI sau; kỳ vọng sau fix bản MỚI lên đầu.
    """
    import backend.app.features.research.search.ranking as ranking
    from backend.app.features.research.models import SearchResult

    monkeypatch.setattr(ranking, "_get_reranker", lambda: None)  # ép fallback

    old = SearchResult(source="web", title="old", url="u1", content="c",
                       score=0.5, extra={"year": 2000})
    new = SearchResult(source="web", title="new", url="u2", content="c",
                       score=0.5, extra={"year": 2024})

    ranked = ranking.rerank_results("q", [old, new], top_k=2)

    assert ranked[0].title == "new"
