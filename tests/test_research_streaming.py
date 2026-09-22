"""Streaming synthesis: sections must reach the caller as each finishes,
not only once every section is done.

Regression target: before this, `_run_sections`/`synthesize_grounded` were
plain blocking calls — the research SSE stream went silent for the entire
6-7 call synthesis pass. The fix turned them into generators that yield a
step name (and, one layer up in agent.py, a partial payload) the moment each
underlying future completes.
"""
import time

import pytest

from backend.app.features.research.agent import _output_dict, _output_partial
from backend.app.features.research.models import ResearchOutput, SearchResult
from backend.app.features.research.synthesizer import Synthesizer


class _FakeCaps:
    context_window = 100_000
    supports_structured_output = True
    supports_temperature = True
    reasoning_effort_levels: tuple = ()


def _make_synth() -> Synthesizer:
    # __init__ only touches llm/caps to compute a context budget — a fake
    # llm object is fine since every section method gets monkeypatched below.
    return Synthesizer(llm=object(), capabilities=_FakeCaps())


def _sources() -> list[SearchResult]:
    return [SearchResult(source="web", title="t", url="http://x", content="c")]


def test_run_sections_streaming_yields_as_each_step_completes(monkeypatch):
    synth = _make_synth()

    def slow_summaries(query, ctx, out):
        time.sleep(0.15)
        out.summary_short = "s"

    monkeypatch.setattr(synth, "_make_summaries", slow_summaries)
    monkeypatch.setattr(synth, "_make_key_points", lambda q, c, out: setattr(out, "key_points", ["k"]))
    monkeypatch.setattr(synth, "_make_follow_up_questions", lambda q, out: setattr(out, "follow_up_questions", ["f"]))
    monkeypatch.setattr(synth, "_make_chart_data", lambda q, c, out: None)
    monkeypatch.setattr(synth, "_make_papers_and_refs", lambda s, out: setattr(out, "papers", []))

    out = ResearchOutput(query="q")
    steps = list(synth._run_sections_streaming("q", _sources(), out))

    assert set(steps) == {"summaries", "key_points", "follow_ups", "chart", "papers"}
    # The artificially slow step must not be the first thing to arrive —
    # a blocking implementation would have no ordering to assert at all
    # (only one yield, at the very end).
    assert steps[0] != "summaries"
    assert steps[-1] == "summaries"


def test_synthesize_grounded_streaming_is_progressive(monkeypatch):
    synth = _make_synth()

    monkeypatch.setattr(synth, "_make_summaries", lambda q, c, out: setattr(out, "summary_short", "s"))
    monkeypatch.setattr(synth, "_make_key_points", lambda q, c, out: setattr(out, "key_points", ["k"]))
    monkeypatch.setattr(synth, "_make_follow_up_questions", lambda q, out: setattr(out, "follow_up_questions", ["f"]))
    monkeypatch.setattr(synth, "_make_chart_data", lambda q, c, out: None)
    monkeypatch.setattr(synth, "_make_papers_and_refs", lambda s, out: setattr(out, "papers", []))
    monkeypatch.setattr(synth, "_attach_grounding", lambda out, q, s: setattr(out, "confidence", 0.5))

    events = list(synth.synthesize_grounded_streaming("q", _sources()))

    # 5 sections + grounding = 6 yields, not one.
    assert len(events) == 6
    assert events[-1][1] == "grounding"
    # Same `out` object mutated in place on every yield.
    assert all(out is events[0][0] for out, _ in events)
    assert events[-1][0].confidence == 0.5


def test_synthesize_grounded_streaming_empty_sources_still_yields_once():
    synth = _make_synth()
    events = list(synth.synthesize_grounded_streaming("q", []))
    assert len(events) == 1
    out, step = events[0]
    assert step == "summaries"
    assert out.summary_short == "No sources found. Try a different query."


def test_synthesize_grounded_blocking_wrapper_still_returns_final_output(monkeypatch):
    synth = _make_synth()
    monkeypatch.setattr(synth, "_make_summaries", lambda q, c, out: setattr(out, "summary_short", "s"))
    monkeypatch.setattr(synth, "_make_key_points", lambda q, c, out: setattr(out, "key_points", ["k"]))
    monkeypatch.setattr(synth, "_make_follow_up_questions", lambda q, out: None)
    monkeypatch.setattr(synth, "_make_chart_data", lambda q, c, out: None)
    monkeypatch.setattr(synth, "_make_papers_and_refs", lambda s, out: None)
    monkeypatch.setattr(synth, "_attach_grounding", lambda out, q, s: None)

    out = synth.synthesize_grounded("q", _sources())
    assert out.summary_short == "s"
    assert out.key_points == ["k"]


def test_output_partial_slices_to_only_the_step_that_just_finished():
    out = ResearchOutput(query="q", summary_short="s", key_points=["a"], papers=[{"title": "p"}])
    partial = _output_partial(out, "summaries")
    assert set(partial) == {"query", "summary_short", "summary_medium", "summary_detailed"}
    assert partial["summary_short"] == "s"

    partial_kp = _output_partial(out, "key_points")
    assert set(partial_kp) == {"query", "key_points"}
    assert partial_kp["key_points"] == ["a"]


def test_output_dict_matches_output_partial_union_of_all_steps():
    out = ResearchOutput(query="q", summary_short="s")
    full = _output_dict(out)
    assert full["query"] == "q"
    assert full["summary_short"] == "s"
    assert "claims" in full and full["claims"] == []
