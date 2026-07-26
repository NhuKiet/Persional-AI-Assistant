"""End-to-end integration tests for the RAG-vs-live-search decision gate.

Every per-seam test (test_agent_gate.py, test_agent_top_up.py,
test_agent_judge_runner.py, test_agent_persistence.py) monkeypatches
`_run_judge` and/or `_top_up` directly at the exact boundary between
components. That means a wiring bug BETWEEN two correctly-tested seams
would slip through every one of those tests without being caught.

These tests run the real chain in one `run_streaming` call:
  - real `sufficiency.assess` (THIN classification via coverage, or MAYBE
    when coverage clears the threshold)
  - real `_run_judge` -> real `sufficiency.judge_sufficiency` (MAYBE path
    only — see below)
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
so `test_thin_state_real_gate_topup_chain_persists_correctly` never
exercises `_run_judge` — its discriminator is the assess -> top_up ->
persist chain. The judge thread-pool poll loop and real
`judge_sufficiency` call are instead covered by
`test_maybe_state_real_judge_chain_routes_to_degraded_on_insufficient`,
which engineers a MAYBE state specifically to reach that seam.
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


def _stored_source_maybe():
    # Heavy token overlap with QUERY's tokens {quantum, error, correction,
    # surface, codes} -> query_coverage() == 1.0 >= KNOWLEDGE_COVERAGE_MIN
    # (0.6) -> sufficiency.assess() genuinely returns MAYBE, not THIN.
    return SearchResult(
        source="web", title="stored-maybe", url="http://example.com/stored-maybe",
        content="quantum error correction surface codes overview",
        extra={"stored_at": time.time()},
    )


def _new_web_source_maybe():
    return SearchResult(
        source="web", title="fresh-maybe", url="http://example.com/fresh-maybe",
        content="detailed quantum error correction surface code threshold analysis",
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


def _fake_llm_call_judge_insufficient(prompt: str) -> str:
    """Serves BOTH the real judge call and the real synthesis calls that
    happen in the same MAYBE->insufficient->top_up->synthesize_grounded
    run_streaming pass — `Synthesizer._call` is a single faked boundary
    invoked from both places, so this distinguishes them by inspecting the
    prompt text (the judge prompt is built by
    `sufficiency.build_judge_prompt` and always contains this exact
    question string; synthesis prompts never do).
    """
    if "Does the stored context contain enough evidence" in prompt:
        # Judge-format response: real judge_sufficiency() + real _parse_obj()
        # + real validate_judge_response() must turn this into (False, "chi
        # tiết cụ thể") for the gate to route to top_up/insufficient.
        return '{"sufficient": false, "missing": "chi tiết cụ thể"}'
    # Any other call is a synthesis call (synthesize_grounded's summary/
    # overview/etc. steps) — canned plain-text response, same shape the
    # THIN test above uses.
    return "SUMMARY: canned summary\nOVERVIEW: canned overview"


def _run_integration(monkeypatch, stored_candidates, stub_web_results,
                      llm_call=_fake_llm_call):
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
    monkeypatch.setattr(agent.synth, "_call", llm_call)

    events = list(agent.run_streaming(
        QUERY, provider=None, model=None, cancel_event=None, history=None,
    ))
    return events, store


def test_thin_state_real_gate_topup_chain_persists_correctly(monkeypatch):
    """End-to-end: real assess()->THIN, real _top_up()->dedup/rerank, real
    persistence, in one run_streaming call — no mocking at the seams between
    them. Only the network/LLM boundary is faked.

    THIN skips the judge by design (see agent.py's gate code: `else:
    sufficient, missing = False, None  # THIN không cần judge`), so this
    test does NOT exercise `_run_judge`/`judge_sufficiency` — for that see
    test_maybe_state_real_judge_chain_routes_to_degraded_on_insufficient
    below, which drives the state to MAYBE specifically to cover the judge
    seam.

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


def test_maybe_state_real_judge_chain_routes_to_top_up_on_insufficient(monkeypatch):
    """End-to-end: real assess()->MAYBE, real _run_judge()->judge_sufficiency()
    (real thread-pool submit/poll loop, real Synthesizer._call and
    Synthesizer._parse_obj at the LLM boundary), real _top_up()->dedup/rerank,
    real persistence — in one run_streaming call.

    This is the discriminator the THIN test above structurally cannot cover:
    THIN skips `_run_judge` entirely, so no committed test exercised the
    judge thread-pool poll loop or a real `judge_sufficiency` call before
    this one. Here the stored source's content is engineered to overlap
    heavily with the query so `sufficiency.query_coverage` clears
    KNOWLEDGE_COVERAGE_MIN and `sufficiency.assess` genuinely returns MAYBE
    (not THIN) — that is what forces control into `_run_judge`.

    The faked `Synthesizer._call` returns the judge's expected
    insufficient-verdict JSON only when it detects the judge prompt (see
    `_fake_llm_call_judge_insufficient`); any other call (the
    `synthesize_grounded` steps that run afterwards on the top-up path)
    gets the canned synthesis text instead. If `_run_judge` were broken and
    always returned (True, None) regardless of the judge's real verdict,
    the gate would take the `reuse`/`sufficient` path instead of `top_up`,
    the assertions below on `decision`/`reason` would fail, and no
    `_top_up` call (hence no add_results persistence) would happen at all —
    so this test genuinely proves the judge's real logic ran and its verdict
    was honored, not just that some code path executed without crashing.
    """
    stored = _stored_source_maybe()
    new_source = _new_web_source_maybe()

    events, store = _run_integration(
        monkeypatch, stored_candidates=[stored], stub_web_results=[new_source],
        llm_call=_fake_llm_call_judge_insufficient,
    )

    decisions = [e for e in events if e.get("type") == "knowledge_decision"]
    assert len(decisions) == 1
    assert decisions[0]["decision"] == "top_up"
    assert decisions[0]["reason"] == "insufficient"

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
