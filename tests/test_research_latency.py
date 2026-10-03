"""Research latency, measured 2026-09-29: 99 s and 123 s per question.

- arXiv and Semantic Scholar answered 429; each request then retried with
  2-10 s back-offs, and the whole search round waited for them until its
  60 s deadline — long after the web results had arrived (3.6 s).
- With every source failing, a second 60 s round ran anyway, for an answer
  with no sources.
- The answer only appeared once the long detailed summary was done (~29 s
  into synthesis), though the short one is ready far sooner.
"""
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest

import backend.app.features.research.agent as agent_mod
import backend.app.features.research.search.crawl as crawl_mod
import backend.app.features.research.search.ranking as ranking_mod
from backend.app.features.research.agent import ResearchAgent
from backend.app.features.research.models import ResearchOutput, SearchResult
from backend.app.features.research.search import academic
from backend.app.features.research.synthesizer import Synthesizer

QUERY = "speculative decoding for llm inference"


# ── a. sources that answer 429 ──────────────────────────────────────────


@pytest.fixture
def clock(monkeypatch):
    now = {"t": 1000.0}
    monkeypatch.setattr(academic, "cooldowns", academic.SourceCooldowns(clock=lambda: now["t"]))
    return now


def test_semantic_scholar_429_returns_at_once_and_rests_the_source(monkeypatch, clock):
    calls = []

    def fake_get(url, **kwargs):
        calls.append(url)
        return httpx.Response(429, request=httpx.Request("GET", url))

    monkeypatch.setattr(academic.httpx, "get", fake_get)
    monkeypatch.setattr(academic.time, "sleep", lambda s: pytest.fail("no back-off retries on a 429"))
    searcher = academic.SemanticScholarSearcher()

    assert searcher.search("q") == []
    assert searcher.search("q") == []  # resting: not even a request
    assert len(calls) == 1

    clock["t"] += academic.COOLDOWN_SECONDS + 1
    searcher.search("q")
    assert len(calls) == 2  # rested long enough: tries again


class _Arxiv429Client:
    calls = 0

    def __init__(self, **kwargs):
        pass

    def results(self, search):
        _Arxiv429Client.calls += 1
        raise RuntimeError("Page request resulted in HTTP 429 (https://export.arxiv.org/api/query)")


def test_arxiv_429_returns_at_once_and_rests_the_source(monkeypatch, clock):
    _Arxiv429Client.calls = 0
    monkeypatch.setattr(academic.arxiv, "Client", _Arxiv429Client)
    monkeypatch.setattr(academic, "_arxiv_gate", academic.RequestSpacing(0, clock=lambda: clock["t"]))
    monkeypatch.setattr(academic.time, "sleep", lambda s: pytest.fail("no back-off retries on a 429"))

    assert academic.ArxivSearcher().search("q") == []
    assert academic.ArxivSearcher().search("q") == []
    assert _Arxiv429Client.calls == 1


def test_arxiv_requests_are_spaced_out_instead_of_fired_together():
    now = {"t": 0.0}
    waits = []

    def sleep(seconds):
        waits.append(seconds)
        now["t"] += seconds

    gate = academic.RequestSpacing(3.0, clock=lambda: now["t"], sleep=sleep)

    gate.wait()
    gate.wait()
    gate.wait()

    assert waits == [3.0, 3.0]


# ── b. the search round doesn't wait for stragglers ─────────────────────


class _Searcher:
    def __init__(self, name, source, delay=0.0, hits=1):
        self.name, self.source, self.delay, self.hits = name, source, delay, hits

    def search(self, query, k):
        time.sleep(self.delay)
        return [
            SearchResult(source=self.source, title=f"{self.name} {i}", url=f"https://ex.com/{self.name}/{i}",
                         content=f"{QUERY} — {self.name} result {i}")
            for i in range(self.hits)
        ]


class _Store:
    def retrieve_candidates(self, query, top_k=None):
        return []

    def add_results(self, query, sources):
        return len(sources)


def _agent(monkeypatch, **searchers):
    monkeypatch.setattr(agent_mod, "needs_iteration", lambda *a, **k: False)
    monkeypatch.setattr(agent_mod, "expand_query", lambda q, **k: [q])
    monkeypatch.setattr(crawl_mod, "_crawl_url", lambda url, timeout=8: None)
    monkeypatch.setattr(ranking_mod, "cross_encoder_scores", lambda q, docs: None)
    monkeypatch.setattr(agent_mod, "get_store", lambda: _Store())

    agent = ResearchAgent.__new__(ResearchAgent)
    agent._pool = ThreadPoolExecutor(max_workers=4)
    defaults = {
        "web": _Searcher("web", "web"), "arxiv": _Searcher("arxiv", "arxiv"),
        "semantic": _Searcher("semantic", "semantic_scholar"), "hf": _Searcher("hf", "huggingface"),
        "ddg": _Searcher("ddg", "duckduckgo"), "so": _Searcher("so", "stackoverflow"),
    }
    for attr, searcher in {**defaults, **searchers}.items():
        setattr(agent, attr, searcher)
    agent.synth = Synthesizer(llm=object())
    monkeypatch.setattr(agent.synth, "_call", lambda p, effort=None: "SUMMARY: s\nOVERVIEW: o")
    return agent


def test_once_enough_results_are_in_slow_sources_get_only_a_short_grace(monkeypatch):
    monkeypatch.setattr(agent_mod, "_ENOUGH_RESULTS", 3)
    monkeypatch.setattr(agent_mod, "_SEARCH_GRACE_SECONDS", 0.3)
    list(_agent(monkeypatch).run_streaming(QUERY))  # warm-up: first run pays ~2 s of imports
    agent = _agent(monkeypatch, arxiv=_Searcher("arxiv", "arxiv", delay=5.0))

    started = time.monotonic()
    events = list(agent.run_streaming(QUERY))

    assert time.monotonic() - started < 3.0  # not the 5 s arXiv takes
    done = {e["source"] for e in events if e.get("type") == "source_done"}
    assert "web" in done and "arxiv" not in done
    assert any(e.get("degraded") and "arxiv" in e["message"] for e in events if e.get("type") == "status")
    assert events[-1]["type"] == "done"


def test_with_too_little_in_the_hard_deadline_still_applies(monkeypatch):
    monkeypatch.setattr(agent_mod, "_SEARCH_TIMEOUT_SECONDS", 0.5)
    list(_agent(monkeypatch).run_streaming(QUERY))  # warm-up, as above
    slow = {attr: _Searcher(attr, "web", delay=5.0) for attr in ("web", "arxiv", "semantic", "hf", "ddg", "so")}
    agent = _agent(monkeypatch, **slow)

    started = time.monotonic()
    events = list(agent.run_streaming(QUERY))

    assert time.monotonic() - started < 3.0
    assert events[-1]["type"] == "done"


# ── c. no second round with nothing to build on ─────────────────────────


def test_no_extra_round_when_the_search_found_nothing(monkeypatch):
    empty = {attr: _Searcher(attr, "web", hits=0) for attr in ("web", "arxiv", "semantic", "hf", "ddg", "so")}
    agent = _agent(monkeypatch, **empty)
    monkeypatch.setattr(agent_mod, "needs_iteration", lambda *a, **k: True)
    extra_rounds = []
    monkeypatch.setattr(agent, "_iteration_step", lambda *a, **k: extra_rounds.append(1))

    events = list(agent.run_streaming(QUERY))

    assert extra_rounds == []
    assert not any(e.get("type") == "iteration" for e in events)
    limitations = events[-1]["data"]["limitations"]
    assert any("Không tìm được nguồn" in note for note in limitations)


# ── e. the short summary first ──────────────────────────────────────────


def test_the_short_summary_shows_before_the_long_one_is_written(monkeypatch):
    synth = Synthesizer(llm=object())
    detailed_gate = threading.Event()

    class SM:
        short, medium = "ngắn", "vừa"

    def call_structured(prompt, schema, effort=None):
        return SM() if schema.__name__ == "SummaryShortMedium" else None

    def call(prompt, effort=None):
        if effort == "high":  # the detailed summary
            detailed_gate.wait(5)
            return "chi tiết"
        return ""

    monkeypatch.setattr(synth, "_call_structured", call_structured)
    monkeypatch.setattr(synth, "_call", call)
    out = ResearchOutput(query=QUERY)
    sources = [SearchResult(source="web", title="t", url="https://ex.com", content=QUERY)]

    seen = []
    for step in synth._run_sections_streaming(QUERY, sources, out):
        seen.append(step)
        if step == "summaries":
            assert (out.summary_short, out.summary_medium, out.summary_detailed) == ("ngắn", "vừa", "")
            detailed_gate.set()

    assert seen.index("summaries") < seen.index("detailed")
    assert out.summary_detailed == "chi tiết"
    assert agent_mod._STEP_FIELDS["summaries"] == ("summary_short", "summary_medium")
    assert agent_mod._STEP_FIELDS["detailed"] == ("summary_detailed",)


def test_an_empty_detailed_summary_falls_back_to_the_medium_one(monkeypatch):
    synth = Synthesizer(llm=object())

    class SM:
        short, medium = "ngắn", "vừa"

    monkeypatch.setattr(synth, "_call_structured",
                        lambda p, schema, effort=None: SM() if schema.__name__ == "SummaryShortMedium" else None)
    monkeypatch.setattr(synth, "_call", lambda p, effort=None: "")
    out = ResearchOutput(query=QUERY)

    list(synth._run_sections_streaming(QUERY, [SearchResult(source="web", title="t", url="https://ex.com", content=QUERY)], out))

    assert out.summary_detailed == "vừa"
