"""
synthesizer.py — LLM synthesis tuned for Ollama/Llama3 local.

Key design decisions:
- One LLM call per section (summaries, key points, compare, chart, follow-ups)
- Prompts are SHORT and explicit — Llama3 struggles with long multi-section prompts
- Every parse has a robust fallback — output is never empty even if LLM misbehaves
- Context is truncated aggressively — local models degrade badly on long contexts
"""

import json
import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from backend.app.core.config import settings
from backend.app.core.llm import get_llm
from backend.app.features.research.grounding import (
    ClaimAuditor, compute_confidence, derive_limitations, extract_claims,
)
from backend.app.features.research.models import ResearchOutput, SearchResult
from backend.app.features.research import prompts
from backend.app.features.research import output_schemas
from backend.app.features.research.search.query import has_compare_intent
from backend.app.features.research.security import frame_untrusted, UNTRUSTED_GUARD

logger = logging.getLogger(__name__)

# Context budget is derived from the configured model, not hardcoded. The
# constants above were sized for "Llama3 8B có context 8k tokens" and starved
# every larger model that followed: each source was truncated to 900 chars
# after the pipeline spent a crawl, a dedup pass and a rerank producing 15
# sources of up to 8000 chars each. Measured before this change, the largest
# context actually sent was 7,203 chars against a 1,050,000-token window.
#
# The four graded budgets they replaced had no technical basis — each section
# is an independent call with the whole context window available to it, so
# splitting one budget across them was never meaningful. One budget now.

_CHARS_PER_TOKEN      = 3.5      # conservative; Vietnamese costs more per char
_MAX_EFFECTIVE_TOKENS = 60_000
_RERANK_TOP_K         = 15       # matches rerank_results(top_k=15) in agent.py


@dataclass(frozen=True)
class ContextBudget:
    max_chars: int
    per_source_chars: int


def budget_for(caps) -> ContextBudget:
    """Half the model's window, hard-capped.

    The cap is deliberate: available material tops out near 15 x 8000 = 120k
    chars (~30k tokens), so a 1M-token model never reaches it. It exists only
    to bound pathological input, not to be a target.
    """
    effective = min(int(caps.context_window * 0.5), _MAX_EFFECTIVE_TOKENS)
    max_chars = int(effective * _CHARS_PER_TOKEN)
    return ContextBudget(
        max_chars=max_chars,
        per_source_chars=max(200, max_chars // _RERANK_TOP_K),
    )


# Placeholder used when the LLM call fails entirely (_call swallows the
# exception and returns ""). Exported so callers building conversation
# history (service.py) can recognize and drop these — a failed turn is not
# real content and must not be fed back as context for follow-up questions.
NO_SUMMARY_FALLBACK = "No summary available."

# Claim-extraction reasoning effort. Unset means "send no reasoning_effort at
# all" — the model's own default, which is what this call site used before
# structured output was introduced.
#
# Measured with a controlled A/B, both arms run back to back so source
# availability stayed comparable (2026-08-19):
#
#     high: grounded 0.287, confidence 0.506, 7 iteration rounds, 86.4s
#     none: grounded 0.442, confidence 0.543, 4 iteration rounds, 81.6s
#
# "high" costs more wall time and more top-up iteration rounds while showing
# the user fewer claims and lower confidence. That is not proof its claims are
# worse — is_grounded is a lexical proxy, and deeper reasoning plausibly yields
# cross-source claims that share fewer tokens with any single cited source —
# but nothing supports paying for it either. RESEARCH_CLAIM_EFFORT keeps the
# knob available for the qualitative comparison that would settle it.
_CLAIM_EFFORT = os.environ.get("RESEARCH_CLAIM_EFFORT") or None


def _content_or_str(content) -> str:
    """Anthropic returns content blocks rather than a plain string."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            b if isinstance(b, str) else b.get("text", "")
            for b in content if isinstance(b, (str, dict))
        )
    return str(content or "")


_WS_RE  = re.compile(r"\s+")
_NUM_RE = re.compile(r"\d+(?:[.,]\d+)?")

_CHART_PUNCT = str.maketrans({
    "‘": "'", "’": "'", "“": '"', "”": '"',
    "–": "-", "—": "-", " ": " ",
})


def _normalize_chart_text(text: str) -> str:
    """Lowercase, fold typographic punctuation, collapse whitespace."""
    return _WS_RE.sub(" ", (text or "").translate(_CHART_PUNCT).lower()).strip()


def _number_forms(value: float) -> set[str]:
    """String forms a model might have written for `value`.

    40.0 is written "40", not "40.0"; 79.5 may appear as "79.5" or "79,5".
    """
    forms = {f"{value:g}"}
    if float(value).is_integer():
        forms.add(str(int(value)))
    return forms | {f.replace(".", ",") for f in forms}


def chart_is_supported(parsed, ctx: str) -> bool:
    """Whether a structured chart is backed by text actually present in `ctx`.

    Pure — no I/O. Charts are the one synthesis output whose content is pure
    numbers, and nothing else in the pipeline verifies them. Measured: charts
    fired on 1 of 8 queries under the old "NO_DATA" text sentinel and 8 of 8
    once the schema asked for a boolean, because the model answers true almost
    always. Requiring a quote that is really in the sources, containing the
    numbers really being plotted, puts the decision back on evidence.
    """
    if not parsed.has_data:
        return False
    if len(parsed.labels) < 2 or len(parsed.values) < 2:
        return False
    if len(parsed.labels) != len(parsed.values):
        return False

    quote = _normalize_chart_text(parsed.source_quote)
    if len(quote) < 15:
        return False
    if quote not in _normalize_chart_text(ctx):
        return False

    quoted_numbers = set(_NUM_RE.findall(quote))
    matched = sum(1 for v in parsed.values if _number_forms(v) & quoted_numbers)
    return matched >= 2


class Synthesizer:
    def __init__(self, llm=None, capabilities=None):
        from backend.app.core.llm import capabilities_for
        self.llm    = llm or get_llm()
        self.caps   = capabilities or capabilities_for()
        self.budget = budget_for(self.caps)

    # ── LLM call ──────────────────────────────────────────────────────────────

    def _bound(self, effort: str | None):
        """The LLM with reasoning effort applied, when the model supports it.

        Call sites always pass their intended effort; models without the knob
        simply ignore it here, so no call site branches on model.
        """
        if effort and effort in self.caps.reasoning_effort_levels:
            try:
                return self.llm.bind(reasoning_effort=effort)
            except Exception as e:  # noqa: BLE001
                logger.warning("Could not bind reasoning_effort=%s: %s", effort, e)
        return self.llm

    def _call(self, prompt: str, effort: str | None = None) -> str:
        try:
            result = _content_or_str(self._bound(effort).invoke(prompt).content)
            logger.info("LLM response: %d chars", len(result))
            logger.debug("LLM (%d chars): %s…", len(result), result[:80])
            return result
        except Exception as e:
            logger.error("LLM call failed: %s", e)
            return ""

    def _call_structured(self, prompt: str, schema, effort: str | None = None):
        """Return a validated schema instance, or None meaning "use the text
        fallback". Never raises: a schema violation must degrade to the legacy
        parse path, not fail the section."""
        if not self.caps.supports_structured_output:
            return None
        try:
            return self._bound(effort).with_structured_output(schema).invoke(prompt)
        except Exception as e:  # noqa: BLE001
            logger.warning(
                "Structured output failed for %s (falling back to text parse): %s",
                getattr(schema, "__name__", schema), e,
            )
            return None

    # ── Context builder ───────────────────────────────────────────────────────

    def _ctx(self, sources: list[SearchResult], max_chars: int | None = None,
             per_source: int | None = None) -> str:
        max_chars  = self.budget.max_chars if max_chars is None else max_chars
        per_source = self.budget.per_source_chars if per_source is None else per_source
        parts, total = [], 0
        for s in sources:
            content_preview = s.content[:per_source]
            chunk = f"[{s.source.upper()}] {s.title}\n{frame_untrusted(content_preview)}"
            if total + len(chunk) > max_chars:
                remaining = max_chars - total
                if remaining > 200:
                    parts.append(chunk[:remaining])
                break
            parts.append(chunk)
            total += len(chunk)
        body = "\n\n---\n\n".join(parts)
        return f"{UNTRUSTED_GUARD}\n\n{body}" if body else body

    # ── JSON parsers ──────────────────────────────────────────────────────────

    def _parse_array(self, text: str) -> list:
        text = re.sub(r"```(?:json)?|```", "", text).strip()
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                return parsed
        except Exception:
            pass
        match = re.search(r"\[[\s\S]*?\]", text)
        if match:
            try:
                return json.loads(match.group(0))
            except Exception:
                pass
        return []

    def _parse_obj(self, text: str) -> dict | None:
        """
        Robust JSON object parser — handles common Llama3 output issues:
          1. Strip markdown fences (```json ... ```)
          2. Strip preamble/postamble text outside the JSON block
          3. Fix single quotes → double quotes
          4. Remove JS-style comments (// ... and /* ... */)
          5. Remove trailing commas before } or ]
          6. Handle truncated JSON by closing open braces/brackets

        Uses rfind-based extraction instead of greedy regex
        to avoid catastrophic backtracking on long LLM output.
        """
        if not text:
            return None

        # Strip markdown fences
        cleaned = re.sub(r"```(?:json)?\s*", "", text)
        cleaned = re.sub(r"```", "", cleaned).strip()

        # Strategy 1 — direct parse
        try:
            parsed = json.loads(cleaned)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass

        # Strategy 2 — extract outermost {...} using index scan (no regex backtracking)
        start = cleaned.find("{")
        end   = cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            candidate = cleaned[start:end + 1]

            try:
                parsed = json.loads(candidate)
                if isinstance(parsed, dict):
                    return parsed
            except Exception:
                pass

            # Strategy 3 — fix single quotes
            try:
                parsed = json.loads(candidate.replace("'", '"'))
                if isinstance(parsed, dict):
                    return parsed
            except Exception:
                pass

            # Strategy 4 — remove JS comments and trailing commas
            no_comments = re.sub(r"//[^\n]*", "", candidate)
            no_comments = re.sub(r"/\*.*?\*/", "", no_comments, flags=re.DOTALL)
            no_trailing  = re.sub(r",\s*([}\]])", r"\1", no_comments)
            try:
                parsed = json.loads(no_trailing)
                if isinstance(parsed, dict):
                    return parsed
            except Exception:
                pass

            # Strategy 5 — close truncated JSON
            truncated = no_trailing.rstrip().rstrip(",")
            open_braces   = truncated.count("{") - truncated.count("}")
            open_brackets = truncated.count("[") - truncated.count("]")
            if open_braces > 0 or open_brackets > 0:
                if truncated and truncated[-1] not in ('"', '}', ']'):
                    truncated += '"'
                truncated += "]" * max(0, open_brackets)
                truncated += "}" * max(0, open_braces)
                try:
                    parsed = json.loads(truncated)
                    if isinstance(parsed, dict):
                        logger.warning("_parse_obj: recovered truncated JSON")
                        return parsed
                except Exception:
                    pass

        logger.warning("_parse_obj: all strategies failed, raw starts with: %r", text[:120])
        return None

    # ── Summary ───────────────────────────────────────────────────────────────

    def _make_summaries(self, query: str, ctx: str, out: ResearchOutput) -> None:
        with ThreadPoolExecutor(max_workers=2) as ex:
            f_sm = ex.submit(
                self._call_structured,
                prompts.summary_short_medium_prompt(query, ctx),
                output_schemas.SummaryShortMedium,
                "medium",
            )
            f_detailed = ex.submit(
                self._call, prompts.summary_detailed_prompt(query, ctx), "high",
            )
            parsed = f_sm.result()
            raw2   = f_detailed.result()

        if parsed is not None:
            out.summary_short  = parsed.short.strip()
            out.summary_medium = parsed.medium.strip()
        else:
            raw1 = self._call(prompts.summary_short_medium_prompt(query, ctx), "medium")
            m = re.search(r"SUMMARY:\s*(.+?)(?=OVERVIEW:|$)", raw1, re.DOTALL | re.IGNORECASE)
            out.summary_short = m.group(1).strip() if m else ""
            m = re.search(r"OVERVIEW:\s*(.+)", raw1, re.DOTALL | re.IGNORECASE)
            out.summary_medium = m.group(1).strip() if m else ""
            if not out.summary_short:
                lines = [l.strip() for l in raw1.splitlines() if l.strip() and len(l.strip()) > 20]
                out.summary_short = lines[0] if lines else NO_SUMMARY_FALLBACK
            if not out.summary_medium:
                out.summary_medium = raw1.strip() or out.summary_short

        if not out.summary_short:
            out.summary_short = NO_SUMMARY_FALLBACK
        out.summary_detailed = raw2.strip() if raw2.strip() else out.summary_medium

        logger.info(
            "Summaries — short: %d, medium: %d, detailed: %d chars",
            len(out.summary_short), len(out.summary_medium), len(out.summary_detailed),
        )

    # ── Key points ────────────────────────────────────────────────────────────

    def _make_key_points(self, query: str, ctx: str, out: ResearchOutput) -> None:
        parsed = self._call_structured(
            prompts.key_points_prompt(query, ctx), output_schemas.KeyPoints, "medium",
        )
        if parsed is not None:
            points = [p.strip() for p in parsed.points if len(p.strip()) > 15]
            if points:
                out.key_points = points
                logger.info("Key points: %d (structured)", len(out.key_points))
                return
            logger.info("Key points: structured result unusable — falling back to text parse")
        raw = self._call(prompts.key_points_prompt(query, ctx), "medium")

        out.key_points = []
        for line in raw.splitlines():
            line = line.strip()
            if re.match(r'^[-•*]?\s*\[(FINDING|METHOD|DATA|TREND|LIMITATION|DEFINITION)\]', line):
                clean = re.sub(r'^[-•*]\s*', '', line).strip()
                if len(clean) > 15:
                    out.key_points.append(clean)

        # Fallback 1: plain bullets
        if not out.key_points:
            for line in raw.splitlines():
                line = line.strip()
                if re.match(r'^[-•*]', line) and len(line) > 20:
                    clean = re.sub(r'^[-•*]\s*', '', line).strip()
                    out.key_points.append(f"[FINDING] {clean}")

        # Fallback 2: any long line
        if not out.key_points and raw.strip():
            out.key_points = [
                f"[FINDING] {l.strip()}"
                for l in raw.splitlines()
                if len(l.strip()) > 30
            ][:8]

        logger.info("Key points: %d", len(out.key_points))

    # ── Comparison table ──────────────────────────────────────────────────────

    def _make_comparison_table(self, query: str, sources: list[SearchResult], out: ResearchOutput) -> None:
        if len(sources) < 2:
            return

        src_text = "\n".join(
            f"{i+1}. [{s.source}] {s.title}: "
            f"{frame_untrusted(s.content[:self.budget.per_source_chars].replace(chr(10), ' '))}"
            for i, s in enumerate(sources)
        )

        parsed = self._call_structured(
            prompts.comparison_table_prompt(query, src_text),
            output_schemas.ComparisonTable, "medium",
        )
        if parsed is not None:
            out.comparison_table = [r.model_dump() for r in parsed.rows]
            logger.info("Comparison: %d rows (structured)", len(out.comparison_table))
            return
        raw = self._call(prompts.comparison_table_prompt(query, src_text), "medium")
        valid = [
            r for r in self._parse_array(raw)
            if isinstance(r, dict) and "source" in r and "main_claim" in r
        ]
        out.comparison_table = valid
        logger.info("Comparison: %d rows", len(out.comparison_table))

    # ── Chart data ────────────────────────────────────────────────────────────

    def _make_chart_data(self, query: str, ctx: str, out: ResearchOutput) -> None:
        parsed = self._call_structured(
            prompts.chart_data_prompt(query, ctx), output_schemas.ChartData, "low",
        )
        if parsed is not None:
            if chart_is_supported(parsed, ctx):
                out.chart_data = parsed.model_dump(exclude={"has_data", "source_quote"})
                logger.info("Chart: %s (structured, quote-verified)",
                            out.chart_data.get("title", ""))
            else:
                logger.info("Chart: rejected — no verifiable numbers in the sources")
            return
        raw = self._call(prompts.chart_data_prompt(query, ctx), "low").strip()
        if raw and "NO_DATA" not in raw.upper():
            chart = self._parse_obj(raw)
            if chart and "labels" in chart and "values" in chart:
                out.chart_data = chart
                logger.info("Chart: %s", chart.get("title", ""))

    # ── Follow-up questions ───────────────────────────────────────────────────

    def _make_follow_up_questions(self, query: str, out: ResearchOutput) -> None:
        parsed_structured = self._call_structured(
            prompts.follow_up_questions_prompt(query), output_schemas.FollowUps, "low",
        )
        if parsed_structured is not None:
            out.follow_up_questions = [q.strip() for q in parsed_structured.questions if "?" in q][:4]
            logger.info("Follow-up questions: %d (structured)", len(out.follow_up_questions))
            return
        raw = self._call(prompts.follow_up_questions_prompt(query), "low")

        parsed     = self._parse_array(raw)
        str_qs     = [q for q in parsed if isinstance(q, str) and "?" in q]

        if str_qs:
            out.follow_up_questions = str_qs[:4]
        else:
            out.follow_up_questions = [
                l.strip().strip('"\'- ').strip()
                for l in raw.splitlines()
                if "?" in l and len(l.strip()) > 15
            ][:4]

        logger.info("Follow-up questions: %d", len(out.follow_up_questions))

    # ── Papers + references ───────────────────────────────────────────────────

    def _make_papers_and_refs(self, sources: list[SearchResult], out: ResearchOutput) -> None:
        for s in sources:
            ref = {
                "id":      s.id,
                "title":   s.title,
                "url":     s.url,
                "source":  s.source,
                "snippet": s.content[:200],
            }
            if s.source in ("arxiv", "semantic_scholar", "huggingface"):
                ref.update(s.extra)
                out.papers.append(ref)
            out.references.append(ref)

    # ── Public API ────────────────────────────────────────────────────────────

    def synthesize_rag(self, query: str, sources: list[SearchResult]) -> ResearchOutput:
        """
        RAG path — 1 LLM call, trả lời tự nhiên như chat.
        Không dùng JSON hay section headers.
        """
        out = ResearchOutput(query=query)

        if not sources:
            out.summary_short = "No sources found. Try a different query."
            return out

        logger.info("[RAG SYNTH] %d sources for: %s", len(sources), query)

        ctx = self._ctx(sources)

        raw = self._call(prompts.rag_synthesis_prompt(query, ctx)).strip()
        logger.info("[RAG SYNTH] LLM raw: %d chars", len(raw))

        # Toàn bộ response là summary_detailed
        out.summary_detailed = raw or "No answer generated."

        # summary_short = 2-3 câu đầu
        sentences = re.split(r'(?<=[.!?])\s+', raw)
        out.summary_short = " ".join(sentences[:3]).strip() if sentences else raw[:300]

        # summary_medium = nửa đầu response
        midpoint = len(raw) // 2
        out.summary_medium = raw[:midpoint].strip() if raw else out.summary_short

        # key_points — tự detect bullet points nếu LLM tự viết
        out.key_points = []
        for line in raw.splitlines():
            line = line.strip()
            if re.match(r"^[-•*]\s+", line) and len(line) > 20:
                out.key_points.append(re.sub(r"^[-•*]\s+", "", line))
        # Nếu LLM không dùng bullets thì tạo từ các câu quan trọng
        if not out.key_points:
            out.key_points = [
                s.strip() for s in sentences
                if len(s.strip()) > 40
            ][:8]

        # follow_up_questions — detect câu hỏi trong response nếu có
        out.follow_up_questions = [
            s.strip() for s in sentences
            if s.strip().endswith("?") and len(s.strip()) > 15
        ][:4]

        # Papers từ metadata. comparison_table stays empty here — it was
        # fabricated filler ("See full source for details") the frontend
        # already discarded; the real comparison table only comes from the
        # gated LLM call in _run_sections.
        self._make_papers_and_refs(sources, out)

        logger.info(
            "[RAG SYNTH] Done — %d chars | points: %d | refs: %d",
            len(out.summary_detailed), len(out.key_points), len(out.references),
        )
        return out

    def _run_sections(self, query: str, sources: list[SearchResult], out: ResearchOutput) -> None:
        """Fill `out` with every synthesis section.

        Steps touch disjoint fields of `out` and never read each other's
        results, so they run concurrently; one failure won't block others.
        """
        logger.info("Synthesizing %d sources for: %s", len(sources), query)
        ranked = sorted(sources, key=lambda s: s.score, reverse=True)

        ctx = self._ctx(ranked)
        steps = [
            ("summaries",    self._make_summaries,           (query, ctx, out)),
            ("key_points",   self._make_key_points,          (query, ctx, out)),
            ("chart",        self._make_chart_data,          (query, ctx, out)),
            ("follow_ups",   self._make_follow_up_questions, (query, out)),
            ("papers",       self._make_papers_and_refs,     (ranked, out)),
        ]
        if has_compare_intent(query):
            steps.insert(2, ("comparison", self._make_comparison_table, (query, ranked, out)))

        with ThreadPoolExecutor(max_workers=len(steps)) as ex:
            futures = {ex.submit(fn, *args): name for name, fn, args in steps}
            for future, step_name in futures.items():
                try:
                    future.result()
                except Exception as e:
                    logger.error("Step '%s' failed: %s", step_name, e, exc_info=True)

        logger.info(
            "Done — short: %r… | points: %d | papers: %d",
            out.summary_short[:60], len(out.key_points), len(out.papers),
        )

    def _attach_grounding(self, out: ResearchOutput, query: str, sources: list[SearchResult]) -> None:
        """Gắn claims đã thẩm định + confidence + limitations vào `out`.

        Fallback-safe: tắt grounding, không nguồn, hay bất kỳ exception nào →
        `out` giữ nguyên (claims rỗng, confidence None).
        """
        if not getattr(settings, "RESEARCH_GROUNDING_ENABLED", True) or not sources:
            return
        try:
            claims = extract_claims(
                query, sources,
                lambda p: self._call(p, _CLAIM_EFFORT),
                self._parse_array,
                structured_call=lambda p: self._call_structured(
                    p, output_schemas.Claims, _CLAIM_EFFORT,
                ),
            )
            claims = ClaimAuditor().verify(claims, sources)
            out.claims      = [c for c in claims if c.grounded]
            out.confidence  = compute_confidence(claims, len(sources))
            out.limitations = derive_limitations(sources, claims)
        except Exception as e:
            logger.error("Grounding failed (non-fatal): %s", e, exc_info=True)

    def synthesize_grounded(self, query: str, sources: list[SearchResult]) -> ResearchOutput:
        """Đường structured (6 call) + grounding.

        Grounding chỉ đọc query + sources nên chạy song song với các section.
        """
        out = ResearchOutput(query=query)

        if not sources:
            logger.warning("Synthesize called with 0 sources")
            out.summary_short = "No sources found. Try a different query."
            return out

        with ThreadPoolExecutor(max_workers=1) as ex:
            grounding = ex.submit(self._attach_grounding, out, query, sources)
            self._run_sections(query, sources, out)
            grounding.result()

        return out

    def synthesize_rag_grounded(self, query: str, sources: list[SearchResult]) -> ResearchOutput:
        """Đường RAG (1 call) + grounding — 2 call thay vì 7.

        Nhánh RAG trước đây trả lời mà không có claims/confidence/limitations,
        nên người dùng không có cách nào biết câu trả lời từ DB đáng tin tới
        đâu. Rẻ vẫn giữ rẻ, nhưng độ tin cậy thì áp dụng cho mọi nhánh.
        """
        out = self.synthesize_rag(query, sources)
        self._attach_grounding(out, query, sources)
        return out
