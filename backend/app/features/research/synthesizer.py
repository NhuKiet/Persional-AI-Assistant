"""
synthesizer.py — LLM synthesis tuned for Ollama/Llama3 local.

Key design decisions:
- One LLM call per section (summaries, key points, compare, chart, follow-ups)
- Prompts are SHORT and explicit — Llama3 struggles with long multi-section prompts
- Every parse has a robust fallback — output is never empty even if LLM misbehaves
- Context is truncated aggressively — local models degrade badly on long contexts
"""

import hashlib
import json
import logging
import re

from backend.app.core.config import settings
from backend.app.core.llm import get_llm
from backend.app.features.research.grounding import (
    ClaimAuditor, compute_confidence, derive_limitations, extract_claims,
)
from backend.app.features.research.models import ResearchOutput, SearchResult
from backend.app.features.research import prompts
from backend.app.features.research.security import frame_untrusted, UNTRUSTED_GUARD

logger = logging.getLogger(__name__)

# Context budgets — tăng để LLM có đủ thông tin tổng hợp
# Llama3 8B có context 8k tokens ~ 6000 ký tự an toàn cho 1 prompt
_CTX_SUMMARY = 7000   # tăng từ 5000
_CTX_POINTS  = 5000   # tăng từ 3500
_CTX_CMP     = 3500   # tăng từ 2500
_CTX_CHART   = 2500   # tăng từ 2000


class Synthesizer:
    def __init__(self, llm=None):
        self.llm = llm or get_llm()

    # ── LLM call ──────────────────────────────────────────────────────────────

    def _call(self, prompt: str) -> str:
        try:
            result = self.llm.invoke(prompt).content
            logger.info("LLM response: %d chars", len(result))
            logger.debug("LLM (%d chars): %s…", len(result), result[:80])
            return result
        except Exception as e:
            logger.error("LLM call failed: %s", e)
            return ""

    # ── Context builder ───────────────────────────────────────────────────────

    def _ctx(self, sources: list[SearchResult], max_chars: int, per_source: int = 900) -> str:
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
        # Call 1: short + medium
        raw1 = self._call(prompts.summary_short_medium_prompt(query, ctx))

        m = re.search(r"SUMMARY:\s*(.+?)(?=OVERVIEW:|$)", raw1, re.DOTALL | re.IGNORECASE)
        out.summary_short = m.group(1).strip() if m else ""

        m = re.search(r"OVERVIEW:\s*(.+)", raw1, re.DOTALL | re.IGNORECASE)
        out.summary_medium = m.group(1).strip() if m else ""

        if not out.summary_short:
            lines = [l.strip() for l in raw1.splitlines() if l.strip() and len(l.strip()) > 20]
            out.summary_short = lines[0] if lines else "No summary available."

        if not out.summary_medium:
            out.summary_medium = raw1.strip() or out.summary_short

        # Call 2: detailed analysis
        raw2 = self._call(prompts.summary_detailed_prompt(query, ctx))
        out.summary_detailed = raw2.strip() if raw2.strip() else out.summary_medium

        logger.info(
            "Summaries — short: %d, medium: %d, detailed: %d chars",
            len(out.summary_short), len(out.summary_medium), len(out.summary_detailed),
        )

    # ── Key points ────────────────────────────────────────────────────────────

    def _make_key_points(self, query: str, ctx: str, out: ResearchOutput) -> None:
        raw = self._call(prompts.key_points_prompt(query, ctx))

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
            f"{i+1}. [{s.source}] {s.title}: {frame_untrusted(s.content[:200].replace(chr(10), ' '))}"
            for i, s in enumerate(sources[:4])
        )

        raw = self._call(prompts.comparison_table_prompt(query, src_text))

        parsed = self._parse_array(raw)
        valid  = [r for r in parsed if isinstance(r, dict) and "source" in r and "main_claim" in r]

        if valid:
            out.comparison_table = valid
        else:
            # Clean fallback — no "Auto-generated entry" noise
            out.comparison_table = [
                {
                    "source":     (s.title[:50] or s.url or s.source),
                    "type":       s.source,
                    "main_claim": s.content[:150].replace("\n", " ").strip() or "See source",
                    "strength":   f"{s.source} source",
                    "limitation": "See full source for details",
                }
                for s in sources[:5]
                if s.title or s.content
            ]

        logger.info("Comparison: %d rows", len(out.comparison_table))

    # ── Chart data ────────────────────────────────────────────────────────────

    def _make_chart_data(self, query: str, ctx: str, out: ResearchOutput) -> None:
        raw = self._call(prompts.chart_data_prompt(query, ctx)).strip()

        if raw and "NO_DATA" not in raw.upper():
            chart = self._parse_obj(raw)
            if chart and "labels" in chart and "values" in chart:
                out.chart_data = chart
                logger.info("Chart: %s", chart.get("title", ""))

    # ── Follow-up questions ───────────────────────────────────────────────────

    def _make_follow_up_questions(self, query: str, out: ResearchOutput) -> None:
        raw = self._call(prompts.follow_up_questions_prompt(query))

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
            if s.source in ("arxiv", "semantic_scholar", "huggingface", "openalex"):
                ref.update(s.extra)
                if s.extra.get("pdf_url"):
                    ref["pdf_filename"] = (
                        hashlib.sha256(s.extra["pdf_url"].encode()).hexdigest()[:16] + ".pdf"
                    )
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

        ctx = self._ctx(sources, max_chars=6500, per_source=1300)

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

        # Comparison + papers từ metadata
        out.comparison_table = [
            {
                "source":     (s.title[:50] or s.url or s.source),
                "type":       s.source,
                "main_claim": s.content[:150].replace("\n", " ").strip() or "See source",
                "strength":   f"{s.source} source",
                "limitation": "See full source for details",
            }
            for s in sources[:5]
            if s.title or s.content
        ]
        self._make_papers_and_refs(sources, out)

        logger.info(
            "[RAG SYNTH] Done — %d chars | points: %d | refs: %d",
            len(out.summary_detailed), len(out.key_points), len(out.references),
        )
        return out

    def synthesize(self, query: str, sources: list[SearchResult]) -> ResearchOutput:
        """Run all synthesis steps. Each step is independent — one failure won't block others."""
        out = ResearchOutput(query=query)

        if not sources:
            logger.warning("Synthesize called with 0 sources")
            out.summary_short = "No sources found. Try a different query."
            return out

        logger.info("Synthesizing %d sources for: %s", len(sources), query)
        ranked = sorted(sources, key=lambda s: s.score, reverse=True)

        for step_name, fn, args in [
            ("summaries",    self._make_summaries,         (query, self._ctx(ranked, _CTX_SUMMARY), out)),
            ("key_points",   self._make_key_points,        (query, self._ctx(ranked, _CTX_POINTS),  out)),
            ("comparison",   self._make_comparison_table,  (query, ranked, out)),
            ("chart",        self._make_chart_data,        (query, self._ctx(ranked, _CTX_CHART),   out)),
            ("follow_ups",   self._make_follow_up_questions,(query, out)),
            ("papers",       self._make_papers_and_refs,   (ranked, out)),
        ]:
            try:
                fn(*args)
            except Exception as e:
                logger.error("Step '%s' failed: %s", step_name, e, exc_info=True)

        logger.info(
            "Done — short: %r… | points: %d | papers: %d",
            out.summary_short[:60], len(out.key_points), len(out.papers),
        )
        return out

    def _attach_grounding(self, out: ResearchOutput, query: str, sources: list[SearchResult]) -> None:
        """Gắn claims đã thẩm định + confidence + limitations vào `out`.

        Fallback-safe: tắt grounding, không nguồn, hay bất kỳ exception nào →
        `out` giữ nguyên (claims rỗng, confidence None).
        """
        if not getattr(settings, "RESEARCH_GROUNDING_ENABLED", True) or not sources:
            return
        try:
            claims = extract_claims(query, sources, self._call, self._parse_array)
            claims = ClaimAuditor().verify(claims, sources)
            out.claims      = [c for c in claims if c.grounded]
            out.confidence  = compute_confidence(claims, len(sources))
            out.limitations = derive_limitations(sources, claims)
        except Exception as e:
            logger.error("Grounding failed (non-fatal): %s", e, exc_info=True)

    def synthesize_grounded(self, query: str, sources: list[SearchResult]) -> ResearchOutput:
        """Đường structured (6 call) + grounding."""
        out = self.synthesize(query, sources)
        self._attach_grounding(out, query, sources)
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

    # ── Follow-up Q&A ─────────────────────────────────────────────────────────

    def answer(self, question: str, context: str) -> str:
        """Answer a follow-up question grounded in previous research context."""
        return self._call(prompts.follow_up_answer_prompt(question, context))
