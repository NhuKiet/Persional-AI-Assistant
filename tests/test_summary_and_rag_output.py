# tests/test_summary_and_rag_output.py
"""Two defects the 2026-08-26 gate comparison surfaced in recorded output.

Both are user-visible and neither concerns the gate itself — see spec section
16.5 of docs/superpowers/specs/2026-08-18-research-grounding-and-model-fit-design.md.
"""
import re

from backend.app.core.llm import ModelCapabilities
from backend.app.features.research.models import ResearchOutput, SearchResult
from backend.app.features.research.output_schemas import SummaryShortMedium
from backend.app.features.research.synthesizer import Synthesizer
from backend.app.features.research import prompts

# The tag ResearchResult.tsx requires before it will render a key point.
UI_TAG = re.compile(r"^\s*-?\s*\[(FINDING|METHOD|DATA|TREND|LIMITATION|DEFINITION)\]")

_STRUCTURED = ModelCapabilities(200_000, True, True)
_PLAIN = ModelCapabilities(8192, False, True)


def _source(content="Nội dung nguồn để tổng hợp. " * 12):
    return SearchResult(source="web", title="T", url="http://x", content=content)


# ── defect 1: the SUMMARY:/OVERVIEW: labels reached the user ────────────────

def test_structured_summary_prompt_does_not_ask_for_labels():
    """Measured: three of four answers had summary_short beginning with the
    literal 'SUMMARY: '. The prompt told the model to start with that label —
    a text-format instruction the schema made redundant — so under structured
    output the model put it inside the field."""
    p = prompts.summary_short_medium_prompt("q", "ctx")
    assert "SUMMARY:" not in p
    assert "OVERVIEW:" not in p


def test_text_fallback_prompt_still_asks_for_labels():
    """The Ollama path parses those labels out of free prose and still needs
    them."""
    p = prompts.summary_short_medium_text_prompt("q", "ctx")
    assert "SUMMARY:" in p
    assert "OVERVIEW:" in p


def test_a_label_the_model_emits_anyway_is_stripped():
    """Defence in depth: the prompt no longer asks, but a model may still
    prefix, and the label must never reach the reader."""
    class _Structured:
        def invoke(self, prompt):
            return SummaryShortMedium(short="SUMMARY: ngắn gọn", medium="OVERVIEW: dài hơn")

    class _LLM:
        def bind(self, **kw):
            return self

        def with_structured_output(self, schema):
            return _Structured()

        def invoke(self, prompt):
            class _R:
                content = "unused"
            return _R()

    s = Synthesizer(llm=_LLM(), capabilities=_STRUCTURED)
    out = ResearchOutput(query="q")
    s._make_summaries("q", "ctx", out)

    assert out.summary_short == "ngắn gọn"
    assert out.summary_medium == "dài hơn"


# ── defect 2: the reuse path's key points were all discarded by the UI ──────

def _rag_synth(text):
    class _LLM:
        def bind(self, **kw):
            return self

        def invoke(self, prompt):
            class _R:
                content = text
            return _R()

    return Synthesizer(llm=_LLM(), capabilities=_PLAIN)


def test_rag_key_points_carry_the_tag_the_ui_requires():
    """Measured on four real answers: 0 of 8, 0 of 40, 0 of 49 and 0 of 90
    key points carried a tag, so every reuse answer rendered no Key Points
    panel at all."""
    bullets = "\n".join(f"- Đây là một ý quan trọng số {i} về chủ đề đang xét" for i in range(5))
    out = _rag_synth(f"Mở đầu.\n{bullets}\n").synthesize_rag("q", [_source()])

    assert out.key_points, "expected key points"
    assert all(UI_TAG.match(k) for k in out.key_points)


def test_rag_key_points_are_capped():
    """The bullet branch had no cap, which is where the recorded 40, 49 and 90
    came from; the sentence branch below it was already capped at 8."""
    bullets = "\n".join(f"- Ý số {i} đủ dài để vượt ngưỡng ký tự tối thiểu" for i in range(40))
    out = _rag_synth(f"Mở đầu.\n{bullets}\n").synthesize_rag("q", [_source()])

    assert len(out.key_points) <= 8


def test_rag_sentence_fallback_is_also_tagged():
    prose = " ".join(
        f"Đây là câu số {i} và nó đủ dài để vượt qua ngưỡng bốn mươi ký tự." for i in range(6)
    )
    out = _rag_synth(prose).synthesize_rag("q", [_source()])

    assert out.key_points
    assert all(UI_TAG.match(k) for k in out.key_points)
    assert len(out.key_points) <= 8
