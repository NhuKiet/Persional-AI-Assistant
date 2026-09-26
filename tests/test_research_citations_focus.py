"""Research: numbered inline citations, and choosing which sources to search.

Citations: the synthesizer numbers the sources it shows the model in the
order `references` is built, asks for `[n]` markers, and removes any marker
that points past the end — so `[n]` always means `references[n - 1]`.

Focus: "academic" / "web" / "code" limit which searchers run (and which
stored knowledge may be reused); "all" keeps today's behaviour.
"""
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

import backend.app.features.research.agent as agent_mod
from backend.app.core.csrf import CLIENT_HEADER
from backend.app.features.research import prompts
from backend.app.features.research.agent import ResearchAgent
from backend.app.features.research.citations import strip_invalid_citations
from backend.app.features.research.models import SearchResult
from backend.app.features.research.schemas import ResearchRequest
from backend.app.features.research.search import crawl as crawl_mod
from backend.app.features.research.search import ranking as ranking_mod
from backend.app.features.research.synthesizer import Synthesizer
from main import app


def _src(title, source="web", content="transformer attention mechanism details"):
    return SearchResult(source=source, title=title, url=f"https://ex.com/{title}", content=content)


# ── Citations ───────────────────────────────────────────────────────────────

def test_context_numbers_sources_in_order():
    ctx = Synthesizer(llm=object())._ctx([_src("Alpha"), _src("Beta", source="arxiv")], max_chars=5000)

    assert ctx.index("[1] [WEB] Alpha") < ctx.index("[2] [ARXIV] Beta")


@pytest.mark.parametrize("build", [
    prompts.summary_short_medium_prompt,
    prompts.summary_short_medium_text_prompt,
    prompts.summary_detailed_prompt,
    prompts.rag_synthesis_prompt,
])
def test_summary_prompts_ask_for_numbered_citations(build):
    assert prompts.CITATION_RULE in build("q", "ctx")


def test_citation_rule_stays_out_of_other_prompts():
    assert prompts.CITATION_RULE not in prompts.key_points_prompt("q", "ctx")


@pytest.mark.parametrize("text,n,expected", [
    ("A [1]. B [2][3].", 3, "A [1]. B [2][3]."),
    ("A [1]. B [7].", 3, "A [1]. B."),
    ("A [0] và [4][2].", 3, "A và [2]."),
    ("Xem [tài liệu](https://x.y) [1].", 1, "Xem [tài liệu](https://x.y) [1]."),
    ("Mảng a[2] và [2](https://x).", 1, "Mảng a[2] và [2](https://x)."),
    ("Không nguồn [1].", 0, "Không nguồn."),
])
def test_strip_invalid_citations(text, n, expected):
    assert strip_invalid_citations(text, n) == expected


def test_rag_answer_keeps_valid_citations_and_references_in_the_same_order(monkeypatch):
    synth = Synthesizer(llm=object())
    monkeypatch.setattr(synth, "_call", lambda prompt, effort=None: "Ý chính [1]. Chi tiết [2][5].")
    sources = [_src("Alpha"), _src("Beta", source="arxiv")]

    out = synth.synthesize_rag("q", sources)

    assert out.summary_detailed == "Ý chính [1]. Chi tiết [2]."
    assert [r["title"] for r in out.references] == ["Alpha", "Beta"]


# ── Focus: request schema ───────────────────────────────────────────────────

def test_focus_defaults_to_all():
    assert ResearchRequest(query="q").focus == "all"


def test_unknown_focus_is_rejected():
    with pytest.raises(ValidationError):
        ResearchRequest(query="q", focus="video")
    response = TestClient(app, headers={CLIENT_HEADER: "test"}).post(
        "/api/research/stream", json={"query": "q", "focus": "video"},
    )
    assert response.status_code == 422


# ── Focus: which searchers run ──────────────────────────────────────────────

QUERY = "transformer attention mechanism"


class _Recorder:
    def __init__(self, name, calls, source):
        self.name, self.calls, self.source = name, calls, source

    def search(self, query, k):
        self.calls.append(self.name)
        return [_src(f"{self.name}-hit", source=self.source, content=f"{QUERY} {self.name} result")]


class _Store:
    def __init__(self, candidates=()):
        self.candidates = list(candidates)

    def retrieve_candidates(self, query, top_k=None):
        return list(self.candidates)

    def add_results(self, query, sources):
        return len(sources)


def _agent(monkeypatch, calls, candidates=()):
    monkeypatch.setattr(agent_mod, "needs_iteration", lambda *a, **k: False)
    monkeypatch.setattr(agent_mod, "expand_query", lambda q, **k: [q])
    monkeypatch.setattr(crawl_mod, "_crawl_url", lambda url, timeout=8: None)
    monkeypatch.setattr(ranking_mod, "cross_encoder_scores", lambda q, docs: None)
    monkeypatch.setattr(agent_mod, "get_store", lambda: _Store(candidates))

    agent = ResearchAgent.__new__(ResearchAgent)
    agent._pool = ThreadPoolExecutor(max_workers=4)
    agent.web = _Recorder("web", calls, "web")
    agent.arxiv = _Recorder("arxiv", calls, "arxiv")
    agent.semantic = _Recorder("semantic", calls, "semantic_scholar")
    agent.hf = _Recorder("huggingface", calls, "huggingface")
    agent.ddg = _Recorder("duckduckgo", calls, "duckduckgo")
    agent.so = _Recorder("stackoverflow", calls, "stackoverflow")
    agent.synth = Synthesizer(llm=object())
    monkeypatch.setattr(agent.synth, "_call", lambda p, effort=None: "SUMMARY: s\nOVERVIEW: o")
    return agent


@pytest.mark.parametrize("focus,expected", [
    ("academic", {"arxiv", "semantic", "huggingface"}),
    ("web", {"web", "duckduckgo"}),
    ("code", {"stackoverflow", "web"}),
    ("all", {"web", "arxiv", "semantic", "huggingface", "duckduckgo", "stackoverflow"}),
])
def test_live_search_runs_only_the_focused_sources(monkeypatch, focus, expected):
    calls = []
    agent = _agent(monkeypatch, calls)

    events = list(agent.run_streaming(QUERY, focus=focus))

    assert set(calls) == expected
    announced = {e["source"] for e in events if e.get("type") == "status" and e.get("source") in agent_mod._SSE_STATUS}
    assert announced == expected


def test_top_up_searches_only_the_focused_sources(monkeypatch):
    # A stored source with no overlap with the query is THIN → top-up search.
    stored = SearchResult(source="arxiv", title="stored", url="https://ex.com/stored",
                          content="python list comprehension syntax", extra={"stored_at": time.time()})
    calls = []
    agent = _agent(monkeypatch, calls, candidates=[stored])

    list(agent.run_streaming(QUERY, focus="academic"))

    assert calls and set(calls) <= {"arxiv", "semantic", "huggingface"}


def test_stored_knowledge_outside_the_focus_is_not_reused(monkeypatch):
    stored_web = SearchResult(source="web", title="stored", url="https://ex.com/stored",
                              content=f"{QUERY} overview", extra={"stored_at": time.time()})
    calls = []
    agent = _agent(monkeypatch, calls, candidates=[stored_web])

    events = list(agent.run_streaming(QUERY, focus="academic"))

    decision = next(e for e in events if e.get("type") == "knowledge_decision")
    assert decision["stored_count"] == 0
    assert decision["decision"] == "search"
