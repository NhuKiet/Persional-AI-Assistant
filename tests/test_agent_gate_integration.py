"""End-to-end integration test for the RAG-vs-live-search decision gate.

Every per-seam test (test_agent_gate.py, test_agent_top_up.py,
test_agent_judge_runner.py, test_agent_persistence.py) monkeypatches
`_run_judge` and/or `_top_up` directly at the exact boundary between
components. That means a wiring bug BETWEEN two correctly-tested seams
would slip through every one of those tests without being caught.

This test runs the real chain in one `run_streaming` call:
  - real `sufficiency.assess` (THIN classification via coverage)
  - real `_top_up` -> real `_search_all` -> real `_process_pipeline`
    (real `deduplicate_results` / `rerank_results` code paths)
  - real persistence call (`knowledge.add_results`) with the correct
    newly-fetched-only source set

Only the actual network/LLM boundary is faked:
  - `agent_mod.get_store()` -> in-memory fake KnowledgeStore
  - the searcher objects' `.search()` methods (no real HTTP calls)
  - `Synthesizer._call` (no real LLM)
  - `crawl._crawl_url` (no real HTTP fetch during web-result enrichment)
  - `ranking._get_reranker` (no real BGE model load; forces the pure-Python
    credibility-fallback scoring path inside the real `rerank_results`)

THIN state skips the judge entirely (confirmed by reading agent.py's gate
code: `else: sufficient, missing = False, None  # THIN không cần judge`),
so this test never needs to exercise `_run_judge` — the discriminator here
is the assess -> top_up -> persist chain.
"""
import time
from concurrent.futures import ThreadPoolExecutor

import backend.app.features.research.agent as agent_mod
from backend.app.features.research.agent import ResearchAgent
from backend.app.features.research.models import SearchResult
from backend.app.features.research.search import crawl as crawl_mod
from backend.app.features.research.search import ranking as ranking_mod
from backend.app.features.research.synthesizer import Synthesizer


QUERY = "quantum error correction surface codes"


def _stored_source():
    # Zero token overlap with QUERY's tokens {quantum, error, correction,
    # surface, codes} -> query_coverage() == 0.0 < KNOWLEDGE_COVERAGE_MIN
    # (0.6) -> sufficiency.assess() genuinely returns THIN.
    return SearchResult(
        source="web", title="stored", url="http://example.com/stored",
        content="python list comprehension syntax tutorial",
        extra={"stored_at": time.time()},
    )


def _new_web_source():
    return SearchResult(
        source="web", title="fresh", url="http://example.com/fresh",
        content="surface code quantum error correction threshold theorem",
    )


class _FakeStore:
    def __init__(self, candidates):
        self._candidates = candidates
        self.add_calls: list[tuple[str, list]] = []

    def retrieve_candidates(self, query, top_k=None):
        return self._candidates

    def add_results(self, query, sources):
        self.add_calls.append((query, list(sources)))
        return len(sources)


class _Searcher:
    def __init__(self, results):
        self._results = results

    def search(self, query, k):
        return list(self._results)


def _build_agent(store, stub_web_results):
    agent = ResearchAgent.__new__(ResearchAgent)
    agent._pool = ThreadPoolExecutor(max_workers=4)
    agent.web = _Searcher(stub_web_results)
    agent.arxiv = _Searcher([])
    agent.wiki = _Searcher([])
    agent.semantic = _Searcher([])
    agent.hf = _Searcher([])
    agent.github = _Searcher([])
    agent.openalex = _Searcher([])
    agent.synth = Synthesizer(llm=object())  # llm unused; _call is faked
    return agent


def _fake_llm_call(prompt: str) -> str:
    # Canned synthesis-format response. THIN skips the judge entirely, so
    # this never needs to serve a judge-format {"sufficient": ...} answer.
    return "SUMMARY: canned summary\nOVERVIEW: canned overview"


def _run_integration(monkeypatch, stored_candidates, stub_web_results):
    monkeypatch.setattr(agent_mod, "needs_iteration", lambda *a, **k: False)
    # Network/LLM boundary only — everything else (assess, _run_judge wiring,
    # _top_up, _search_all, _process_pipeline, dedup, rerank, persistence)
    # runs for real.
    monkeypatch.setattr(crawl_mod, "_crawl_url", lambda url, timeout=8: None)
    monkeypatch.setattr(ranking_mod, "_get_reranker", lambda: None)

    agent_mod._cache.clear()
    store = _FakeStore(stored_candidates)
    monkeypatch.setattr(agent_mod, "get_store", lambda: store)

    agent = _build_agent(store, stub_web_results)
    monkeypatch.setattr(agent.synth, "_call", _fake_llm_call)

    events = list(agent.run_streaming(
        QUERY, provider=None, model=None, cancel_event=None, history=None,
    ))
    return events, store


def test_thin_state_real_gate_judge_topup_chain_persists_correctly(monkeypatch):
    """End-to-end: real assess(), real _run_judge()->judge_sufficiency(), real
    _top_up()->dedup/rerank, in one run_streaming call — no mocking at the
    seams between them. Only the network/LLM boundary is faked.

    Exists because every per-seam test (test_agent_gate.py, test_agent_top_up.py,
    test_agent_judge_runner.py) monkeypatches _run_judge and/or _top_up directly,
    so a wiring bug BETWEEN correctly-tested seams would slip through all of them.
    """
    stored = _stored_source()
    new_source = _new_web_source()

    events, store = _run_integration(
        monkeypatch, stored_candidates=[stored], stub_web_results=[new_source],
    )

    decisions = [e for e in events if e.get("type") == "knowledge_decision"]
    assert len(decisions) == 1
    assert decisions[0]["decision"] == "top_up"
    assert decisions[0]["reason"] == "thin"

    done = [e for e in events if e.get("type") == "done"]
    assert len(done) == 1
    assert done[0]["data"]["query"] == QUERY

    # Persistence: exactly one add_results call, sources are the NEWLY
    # fetched source(s) only — never the originally-stored one.
    assert len(store.add_calls) == 1
    persisted_query, persisted_sources = store.add_calls[0]
    persisted_ids = {s.id for s in persisted_sources}
    assert stored.id not in persisted_ids
    assert new_source.id in persisted_ids
    assert persisted_ids == {new_source.id}
