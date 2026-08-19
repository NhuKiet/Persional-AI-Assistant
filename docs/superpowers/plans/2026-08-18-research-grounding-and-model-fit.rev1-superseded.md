# Research Grounding Repair and Model Fit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make citation grounding actually work for Vietnamese queries, retune the synthesis pipeline for `gpt-5.6-luna` instead of Llama3 8B, unify the two rerank paths, steer iteration from real evidence gaps, and delete code with no production caller.

**Architecture:** Claims carry a verbatim quote copied from the source they cite, so verification becomes a same-language string comparison instead of a doomed Vietnamese-vs-English token overlap. Model limits move into a capability table in `core/llm.py`, from which the synthesizer derives one context budget instead of four hardcoded constants. Structured output becomes the primary parse path with the existing JSON-repair ladder demoted to fallback for Ollama.

**Tech Stack:** Python 3.11+, FastAPI, LangChain (`langchain-openai` 1.3.3, `langchain-core` 1.4.9), Pydantic 2.13.4, Weaviate, pytest 8.3.4.

**Spec:** `docs/superpowers/specs/2026-08-18-research-grounding-and-model-fit-design.md`

## Global Constraints

- Python interpreter for every command: `.venv/Scripts/python.exe` (Windows, Git Bash shell).
- Test root is `tests/` (`pyproject.toml` sets `testpaths = ["tests"]`). Backend code lives under `backend/app/`.
- `tests/test_news_fetcher.py` has **4 pre-existing failures** unrelated to this work. A run showing exactly those 4 failures and nothing else is green. Baseline before this plan: **449 passed, 4 failed, 17 skipped**.
- `grounding.py`, `sufficiency.py`, `iteration.py`, `chunking.py` and the scoring functions in `ranking.py`/`reranker.py` are **pure — no I/O, no network, no imports of embeddings or LLM clients**. New verification logic must preserve this. Anything needing I/O is injected as a callable by the caller, matching how `extract_claims` already takes `llm_call`.
- Every LLM step must degrade non-fatally. A provider outage, a schema violation, or a malformed response must never fail a research run.
- Vietnamese is the product's answer language (`prompts.LANGUAGE_RULE`). Do not remove it; scope it per-field where needed.
- Ollama/llama3 remains supported. Nothing may assume structured output or a large context window is available.
- Quote verification threshold: `0.85`. Minimum usable quote length: `20` characters. Batch fallback trigger: `>= 3` claims and `< 30%` grounded. Embedding fallback threshold: `0.2`. Anchor-filter safety guard: keep everything if the filter would drop `> 80%`.
- Context budget formula, exact: `effective_tokens = min(context_window * 0.5, 60_000)`; `max_chars = effective_tokens * 3.5`; `per_source_chars = max_chars // 15`.
- Commit after every task. Never use `--no-verify`.

---

## File Structure

**Created:**
- `tools/research_probe.py` — dev-only measurement script; runs fixed queries in-process and prints mechanical metrics.
- `backend/app/features/research/output_schemas.py` — Pydantic schemas for LLM structured output. Separate from `schemas.py`, which is HTTP request/response only.
- `tests/test_grounding_quotes.py` — quote normalization and support scoring.
- `tests/test_claim_auditor.py` — verification and batch fallback.
- `tests/test_model_capabilities.py` — capability table, resolution, budget derivation.
- `tests/test_structured_output.py` — structured path and its fallback.

**Modified:**
- `backend/app/core/llm.py` — `ModelCapabilities`, `MODEL_CAPABILITIES`, `_resolve_model`, `capabilities_for`.
- `backend/app/features/research/models.py` — `Claim.quote`.
- `backend/app/features/research/grounding.py` — unicode tokenizer, `normalize`, `quote_support`, `ClaimAuditor` rework, anchor-filter guard.
- `backend/app/features/research/prompts.py` — claim extraction quote field, follow-up questions gain source context, remove `follow_up_answer_prompt`.
- `backend/app/features/research/synthesizer.py` — `ContextBudget`, structured output, reasoning effort, comparison gating, removals.
- `backend/app/features/research/iteration.py` — `gap_query` priority order.
- `backend/app/features/research/agent.py` — pass capabilities to `Synthesizer`, pass judge `missing` and claims into iteration, removals.
- `backend/app/features/research/search/query.py` — `COMPARE_KEYWORDS`, `has_compare_intent`.
- `backend/app/features/research/search/ranking.py` — use `cross_encoder_scores` and shared `fuse_scores`; `recency_score` accepts `published_at`.
- `backend/app/features/research/reranker.py` — `fuse_scores` gains recency/citation.
- `backend/app/features/research/router.py` — remove `/api/paper/{filename}` and `DELETE /api/research/cache`.
- `backend/app/features/research/service.py` — remove `clear_cache`.
- `backend/app/features/research/search/community.py` — remove `_search_models`.
- `frontend/src/components/research/ResearchResult.tsx` — drop `hasCompareIntent`; render quotes under claims.
- Tests touched by removals: `tests/test_security_framing.py`, `tests/test_research_wiring.py`, `tests/test_iteration_pure.py`, `tests/contract/test_api_contracts.py`.

---

### Task 1: Measurement probe and baseline

Establishes the numbers this whole plan is judged against. Must run **before** any behavior change.

**Files:**
- Create: `tools/research_probe.py`

**Interfaces:**
- Produces: a CLI script. No importable API other tasks depend on.

- [ ] **Step 1: Write the probe script**

Create `tools/research_probe.py`:

```python
"""Dev-only measurement probe for the research pipeline.

Runs a fixed query set in-process and prints the mechanical signals the
2026-08-18 grounding/model-fit work targets. Deliberately does NOT score
answer quality — it measures only what is objectively countable.

Usage:  .venv/Scripts/python.exe tools/research_probe.py --out baseline.json
"""
from __future__ import annotations

import argparse
import json
import time

QUERIES = [
    "RAG hoạt động thế nào",
    "So sánh DPO và PPO trong huấn luyện mô hình ngôn ngữ",
    "Mô hình khuếch tán khác GAN ở điểm nào",
    "Kỹ thuật lượng tử hóa mô hình ngôn ngữ lớn mới nhất",
    "Vector database nào phù hợp cho hệ thống RAG production",
    "Cách đánh giá chất lượng hệ thống RAG",
    "Mixture of Experts là gì",
    "Chain of thought prompting có thực sự hiệu quả không",
]


def _instrument():
    """Wrap pure functions with counters. Returns (counters, restore_fn)."""
    from backend.app.features.research import grounding
    from backend.app.features.research.synthesizer import Synthesizer

    counters = {"claims_extracted": 0, "ctx_chars": 0}
    orig_extract = grounding.extract_claims
    orig_ctx = Synthesizer._ctx

    def extract(query, sources, llm_call, parse_array):
        out = orig_extract(query, sources, llm_call, parse_array)
        counters["claims_extracted"] += len(out)
        return out

    def ctx(self, sources, max_chars, per_source=900):
        text = orig_ctx(self, sources, max_chars, per_source)
        counters["ctx_chars"] = max(counters["ctx_chars"], len(text))
        return text

    grounding.extract_claims = extract
    Synthesizer._ctx = ctx

    def restore():
        grounding.extract_claims = orig_extract
        Synthesizer._ctx = orig_ctx

    return counters, restore


def run_one(agent, query: str) -> dict:
    counters, restore = _instrument()
    t0 = time.time()
    rounds = 0
    output = None
    error = None
    try:
        core = agent.run_streaming(query)
        while True:
            try:
                event = next(core)
            except StopIteration as stop:
                output = stop.value
                break
            if event.get("type") == "iteration":
                rounds += 1
            if event.get("type") == "error":
                error = event.get("message")
    except Exception as e:  # noqa: BLE001 — a probe must report, not crash
        error = f"{type(e).__name__}: {e}"
    finally:
        restore()

    row = {
        "query": query,
        "error": error,
        "wall_seconds": round(time.time() - t0, 1),
        "iteration_rounds": rounds,
        "claims_extracted": counters["claims_extracted"],
        "ctx_chars_max": counters["ctx_chars"],
    }
    if output is not None:
        row.update(
            claims_grounded=len(output.claims),
            confidence=output.confidence,
            sources_into_synthesis=len(output.references),
            chart_produced=output.chart_data is not None,
            comparison_rows=len(output.comparison_table),
        )
    if row.get("claims_extracted"):
        row["grounded_fraction"] = round(
            row.get("claims_grounded", 0) / row["claims_extracted"], 3
        )
    return row


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="path to write JSON results")
    args = ap.parse_args()

    from backend.app.features.research.agent import ResearchAgent

    agent = ResearchAgent()
    rows = []
    for q in QUERIES:
        print(f"→ {q}")
        row = run_one(agent, q)
        rows.append(row)
        print(f"   {json.dumps(row, ensure_ascii=False)}")

    ok = [r for r in rows if not r.get("error")]
    summary = {
        "runs": len(rows),
        "errors": len(rows) - len(ok),
        "mean_grounded_fraction": (
            round(sum(r.get("grounded_fraction", 0.0) for r in ok) / len(ok), 3) if ok else None
        ),
        "mean_confidence": (
            round(sum((r.get("confidence") or 0.0) for r in ok) / len(ok), 3) if ok else None
        ),
        "total_iteration_rounds": sum(r["iteration_rounds"] for r in rows),
        "charts_produced": sum(1 for r in ok if r.get("chart_produced")),
        "mean_ctx_chars": (
            round(sum(r["ctx_chars_max"] for r in ok) / len(ok)) if ok else None
        ),
        "mean_wall_seconds": (
            round(sum(r["wall_seconds"] for r in ok) / len(ok), 1) if ok else None
        ),
    }
    print("\nSUMMARY:", json.dumps(summary, ensure_ascii=False, indent=2))
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"summary": summary, "rows": rows}, f, ensure_ascii=False, indent=2)
    print(f"written: {args.out}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the baseline**

Run:
```bash
.venv/Scripts/python.exe tools/research_probe.py --out docs/superpowers/plans/assets/2026-08-18-baseline.json
```

Create the directory first if needed: `mkdir -p docs/superpowers/plans/assets`.

This makes ~8 live research runs. Expect several minutes and roughly $0.02.

- [ ] **Step 3: Check the falsification criterion**

The spec predicts the baseline shows `mean_grounded_fraction` near 0, `mean_confidence` near 0, and `total_iteration_rounds` equal to the number of runs (one forced round each).

**If the baseline does NOT show this, STOP.** The diagnosis in spec §1.1 is wrong and the design must be revisited before any further task. Report the actual numbers and halt.

- [ ] **Step 4: Commit**

```bash
git add -f tools/research_probe.py docs/superpowers/plans/assets/2026-08-18-baseline.json docs/superpowers/plans/2026-08-18-research-grounding-and-model-fit.md
git commit -m "chore(research): add measurement probe and record baseline"
```

---

### Task 2: Quote normalization and support scoring

Pure functions only. No callers yet.

**Files:**
- Modify: `backend/app/features/research/grounding.py`
- Test: `tests/test_grounding_quotes.py` (create)

**Interfaces:**
- Produces: `normalize(text: str) -> str`, `quote_support(quote: str, source: str) -> float`, constants `_QUOTE_MIN_CHARS = 20`, `QUOTE_THRESHOLD = 0.85`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_grounding_quotes.py`:

```python
# tests/test_grounding_quotes.py
from backend.app.features.research.grounding import (
    QUOTE_THRESHOLD, normalize, quote_support,
)

SOURCE = (
    "Diffusion models are increasingly replacing GANs for image synthesis "
    "tasks due to better mode coverage. DPO reduces training time by 40% "
    "compared to PPO while maintaining similar reward model performance."
)


def test_normalize_collapses_whitespace_and_lowercases():
    assert normalize("  The   Sky\nis BLUE  ") == "the sky is blue"


def test_normalize_maps_curly_quotes_and_dashes_to_ascii():
    assert normalize("“state–of‐the‑art”") == '"state-of-the-art"'


def test_quote_support_exact_substring_is_one():
    quote = "Diffusion models are increasingly replacing GANs"
    assert quote_support(quote, SOURCE) == 1.0


def test_quote_support_survives_punctuation_substitution():
    quote = "DPO reduces training time by 40%   compared to PPO"
    assert quote_support(quote, SOURCE) == 1.0


def test_quote_support_partial_paraphrase_is_below_threshold():
    quote = "Diffusion approaches have gradually supplanted adversarial networks entirely"
    assert quote_support(quote, SOURCE) < QUOTE_THRESHOLD


def test_quote_support_keeps_short_numeric_tokens():
    # "40" must count — figures are exactly what verification exists to catch.
    quote = "reduces training time by 40 percent versus PPO baseline"
    score = quote_support(quote, SOURCE)
    assert 0.0 < score < 1.0


def test_quote_shorter_than_minimum_is_rejected():
    assert quote_support("GANs", SOURCE) == 0.0


def test_quote_empty_is_rejected():
    assert quote_support("", SOURCE) == 0.0
    assert quote_support("   ", SOURCE) == 0.0


def test_quote_support_empty_source_is_zero():
    assert quote_support("Diffusion models are increasingly replacing GANs", "") == 0.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_grounding_quotes.py -v`

Expected: FAIL — `ImportError: cannot import name 'QUOTE_THRESHOLD'`.

- [ ] **Step 3: Implement**

In `backend/app/features/research/grounding.py`, add after the existing `_TOKEN_RE` block:

```python
# ── Quote-anchored verification ──────────────────────────────────────────────
# Claims are written in Vietnamese (prompts.LANGUAGE_RULE) while sources are
# predominantly English, so token overlap between a claim and its source is
# near zero even for a faithful claim — measured 0.03-0.11 against a 0.12
# threshold. Verification therefore compares a verbatim quote the model copied
# out of the source against that source: same language on both sides, and it
# answers the stronger question ("is this sentence actually in the source?")
# instead of the weaker one ("does this look similar?").

QUOTE_THRESHOLD = 0.85

# Below this length a quote matches almost any source by accident — a model
# returning "AI" would ground every claim.
_QUOTE_MIN_CHARS = 20

# Models routinely substitute typographic variants when copying text.
_PUNCT_MAP = str.maketrans({
    "‘": "'", "’": "'", "‚": "'", "‛": "'",
    "“": '"', "”": '"', "„": '"', "‟": '"',
    "‐": "-", "‑": "-", "‒": "-", "–": "-",
    "—": "-", "―": "-", " ": " ",
})

_UNICODE_TOKEN_RE = re.compile(r"\w+", re.UNICODE)


def normalize(text: str) -> str:
    """Lowercase, fold typographic punctuation to ASCII, collapse whitespace."""
    if not text:
        return ""
    return " ".join(text.translate(_PUNCT_MAP).lower().split())


def _quote_tokens(text: str) -> set[str]:
    """Tokens for partial quote matching.

    Short tokens are dropped so stopwords can't inflate the score toward the
    0.85 threshold — except pure digits, which are kept at any length because
    figures ("40", "7B") are precisely what this check exists to verify.
    """
    return {
        t for t in _UNICODE_TOKEN_RE.findall(text)
        if len(t) >= 3 or t.isdigit()
    }


def quote_support(quote: str, source: str) -> float:
    """How well `quote` is backed by `source`, in [0, 1].

    1.0 when the normalized quote appears verbatim. Otherwise the fraction of
    the quote's substantive tokens present in the source, which tolerates a
    model that copied almost-faithfully while still failing an invention.
    """
    q, s = normalize(quote), normalize(source)
    if len(q) < _QUOTE_MIN_CHARS or not s:
        return 0.0
    if q in s:
        return 1.0
    q_tokens = _quote_tokens(q)
    if not q_tokens:
        return 0.0
    return len(q_tokens & _quote_tokens(s)) / len(q_tokens)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_grounding_quotes.py -v`

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app/features/research/grounding.py tests/test_grounding_quotes.py
git commit -m "feat(research): add quote normalization and support scoring"
```

---

### Task 3: Unicode tokenizer and the anchor-filter safety guard

These ship together deliberately: the tokenizer fix alone turns a dead filter into a destructive one.

**Files:**
- Modify: `backend/app/features/research/grounding.py:19` and `filter_by_anchor_relevance`
- Test: `tests/test_grounding_pure.py` (extend)

**Interfaces:**
- Consumes: nothing from Task 2.
- Produces: `tokenize` now unicode-aware; `filter_by_anchor_relevance` gains a batch guard. Signature unchanged: `filter_by_anchor_relevance(query: str, results: list[SearchResult], label: str = "") -> list[SearchResult]`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_grounding_pure.py`:

```python
from backend.app.features.research.grounding import (
    anchor_tokens, filter_by_anchor_relevance,
)


def _r(title, content=""):
    return SearchResult(source="web", title=title, url="http://x", content=content)


def test_tokenize_keeps_vietnamese_diacritics():
    assert "khuếch" in tokenize("mô hình khuếch tán")
    assert "hình" in tokenize("mô hình khuếch tán")


def test_anchor_tokens_nonempty_for_vietnamese_query():
    assert anchor_tokens("mô hình ngôn ngữ lớn là gì")


def test_anchor_filter_keeps_all_when_it_would_drop_almost_everything():
    """Vietnamese query against English sources: zero overlap is a language
    mismatch, not proof that every source is off-topic."""
    results = [_r(f"Diffusion models paper {i}", "English abstract text") for i in range(5)]
    kept = filter_by_anchor_relevance("mô hình khuếch tán là gì", results)
    assert len(kept) == 5


def test_anchor_filter_still_drops_a_lone_off_topic_result():
    results = [
        _r("Diffusion models for image synthesis", "diffusion synthesis"),
        _r("Diffusion probabilistic models", "diffusion models"),
        _r("Diffusion in materials science", "diffusion coefficient"),
        _r("Kubernetes autoscaling guide", "horizontal pod autoscaler replicas"),
    ]
    kept = filter_by_anchor_relevance("diffusion models image synthesis", results)
    assert len(kept) == 3
    assert all("Kubernetes" not in r.title for r in kept)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_grounding_pure.py -v -k "vietnamese or anchor_filter or anchor_tokens"`

Expected: FAIL — `test_tokenize_keeps_vietnamese_diacritics` and `test_anchor_tokens_nonempty_for_vietnamese_query` fail on the ASCII regex; `test_anchor_filter_keeps_all_when_it_would_drop_almost_everything` passes accidentally today (empty anchors ⇒ no filtering) and must keep passing after the tokenizer change.

- [ ] **Step 3: Implement the tokenizer change**

In `backend/app/features/research/grounding.py`, replace line 19:

```python
_TOKEN_RE = re.compile(r"[a-z0-9]+")
```

with:

```python
# Unicode-aware: `[a-z0-9]+` drops every accented character, so a Vietnamese
# query tokenizes to fragments ("khuếch" → "khu") or to nothing at all. Same
# fix, same reason, as sufficiency.py:36.
_TOKEN_RE = re.compile(r"\w+", re.UNICODE)
```

- [ ] **Step 4: Implement the batch guard**

Replace the body of `filter_by_anchor_relevance` in the same file:

```python
# If the anchor would eliminate nearly everything, the anchor is wrong, not
# the corpus — most often a Vietnamese query against English sources, which
# share no tokens by construction. Dropping the whole result set would be a
# far worse failure than skipping this last-resort net.
_ANCHOR_MAX_DROP_RATIO = 0.8


def filter_by_anchor_relevance(
    query: str, results: list[SearchResult], label: str = "",
) -> list[SearchResult]:
    """Drop results that share no substantive term with `query`.

    Meant as a last-resort net against retrieval contamination — apply it
    to raw search-engine output, anchored to the user's actual (clean)
    query, never to an LLM-expanded or gap-filling query (those are
    exactly the noisy text that produces contaminated matches in the
    first place — filtering against them would just rubber-stamp their
    own noise).
    """
    if not results:
        return results
    kept = [r for r in results if shares_anchor_token(query, r.title, r.content)]
    dropped = len(results) - len(kept)
    if not dropped:
        return kept
    if dropped / len(results) > _ANCHOR_MAX_DROP_RATIO:
        logger.info(
            "[RELEVANCE] anchor would drop %d/%d — treating as anchor/corpus "
            "language mismatch, keeping all%s",
            dropped, len(results), f" ({label})" if label else "",
        )
        return results
    logger.info(
        "[RELEVANCE] dropped %d/%d results with no anchor-token overlap%s",
        dropped, len(results), f" ({label})" if label else "",
    )
    return kept
```

- [ ] **Step 5: Run the full grounding and search test files**

Run: `.venv/Scripts/python.exe -m pytest tests/test_grounding_pure.py tests/test_grounding_quotes.py tests/test_grounding_llm.py tests/test_models_grounding.py -v`

Expected: PASS. `test_tokenize_drops_short_tokens_and_lowercases` still passes — `\w+` matches ASCII identically.

- [ ] **Step 6: Commit**

```bash
git add backend/app/features/research/grounding.py tests/test_grounding_pure.py
git commit -m "fix(research): unicode-aware tokenizer with anchor-filter language guard"
```

---

### Task 4: Claim.quote, extraction prompt, and the reworked auditor

**Files:**
- Modify: `backend/app/features/research/models.py`, `grounding.py`, `prompts.py`
- Test: `tests/test_claim_auditor.py` (create)

**Interfaces:**
- Consumes: `quote_support`, `QUOTE_THRESHOLD` (Task 2).
- Produces:
  - `Claim(text, source_ids, evidence_type="uncertain", grounded=True, quote="")`
  - `ClaimAuditor(threshold=0.12, quote_threshold=QUOTE_THRESHOLD, fallback_scorer=None)` with `verify(claims, sources) -> list[Claim]`
  - `fallback_scorer` type: `Callable[[list[tuple[str, str]]], list[float]]` — takes `(claim_text, cited_source_text)` pairs, returns one similarity in `[0, 1]` per pair, or `[]` on failure.
  - `FALLBACK_THRESHOLD = 0.2`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_claim_auditor.py`:

```python
# tests/test_claim_auditor.py
from backend.app.features.research.grounding import ClaimAuditor
from backend.app.features.research.models import Claim, SearchResult

SRC_TEXT = (
    "Diffusion models are increasingly replacing GANs for image synthesis "
    "tasks due to better mode coverage."
)


def _source():
    return SearchResult(source="web", title="T", url="http://x", content=SRC_TEXT)


def _claim(text, quote, source_id):
    return Claim(text=text, source_ids=[source_id], evidence_type="direct", quote=quote)


def test_claim_with_verbatim_quote_is_grounded():
    s = _source()
    c = _claim("Mô hình khuếch tán đang thay thế GAN",
               "Diffusion models are increasingly replacing GANs", s.id)
    out = ClaimAuditor().verify([c], [s])
    assert out[0].grounded is True


def test_claim_with_invented_quote_is_not_grounded():
    s = _source()
    c = _claim("Mô hình khuếch tán nhanh hơn GAN 12 lần",
               "Diffusion models run twelve times faster than adversarial networks", s.id)
    out = ClaimAuditor().verify([c], [s])
    assert out[0].grounded is False


def test_ungrounded_direct_claim_is_downgraded_to_uncertain():
    s = _source()
    c = _claim("bịa", "Completely fabricated sentence not present anywhere here", s.id)
    out = ClaimAuditor().verify([c], [s])
    assert out[0].evidence_type == "uncertain"


def test_claim_without_quote_falls_back_to_lexical_support():
    """English claim, English source: the legacy lexical path still works."""
    s = _source()
    c = Claim(text="diffusion models are replacing gans for image synthesis",
              source_ids=[s.id], evidence_type="direct", quote="")
    out = ClaimAuditor().verify([c], [s])
    assert out[0].grounded is True


def test_batch_fallback_fires_when_quotes_are_unusable():
    s = _source()
    claims = [_claim(f"claim {i}", f"paraphrased sentence number {i} not in source", s.id)
              for i in range(4)]
    seen = {}

    def scorer(pairs):
        seen["pairs"] = pairs
        return [0.9] * len(pairs)

    out = ClaimAuditor(fallback_scorer=scorer).verify(claims, [s])
    assert len(seen["pairs"]) == 4
    assert all(c.grounded for c in out)


def test_batch_fallback_does_not_fire_when_quotes_work():
    """Four claims so the min-claims guard is satisfied and this test can only
    pass on the 30% threshold logic — two grounded out of four is 0.5."""
    s = _source()
    claims = [
        _claim("ok1", "Diffusion models are increasingly replacing GANs", s.id),
        _claim("ok2", "for image synthesis tasks due to better mode coverage", s.id),
        _claim("bad1", "invented sentence absent from the source text here", s.id),
        _claim("bad2", "another fabricated sentence nowhere in the source", s.id),
    ]
    called = []

    out = ClaimAuditor(fallback_scorer=lambda pairs: called.append(pairs) or []).verify(claims, [s])
    assert sum(1 for c in out if c.grounded) == 2   # 0.5 >= 0.3, above the trigger
    assert called == []


def test_batch_fallback_needs_at_least_three_claims():
    s = _source()
    claims = [_claim(f"c{i}", f"invented sentence number {i} absent from source", s.id)
              for i in range(2)]
    called = []

    ClaimAuditor(fallback_scorer=lambda pairs: called.append(pairs) or []).verify(claims, [s])
    assert called == []


def test_batch_fallback_scorer_failure_keeps_quote_verdicts():
    s = _source()
    claims = [_claim(f"c{i}", f"invented sentence number {i} absent from source", s.id)
              for i in range(4)]

    out = ClaimAuditor(fallback_scorer=lambda pairs: []).verify(claims, [s])
    assert all(not c.grounded for c in out)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_claim_auditor.py -v`

Expected: FAIL — `TypeError: Claim.__init__() got an unexpected keyword argument 'quote'`.

- [ ] **Step 3: Add the `quote` field**

In `backend/app/features/research/models.py`, replace the `Claim` dataclass:

```python
@dataclass
class Claim:
    text: str
    source_ids: list[str]
    evidence_type: str = "uncertain"   # "direct" | "inference" | "opinion" | "uncertain"
    grounded: bool = True
    # Verbatim excerpt copied out of the cited source, in the source's own
    # language. Verification compares this against the source rather than
    # comparing the Vietnamese `text` against an English source.
    quote: str = ""
```

- [ ] **Step 4: Rework `ClaimAuditor`**

In `backend/app/features/research/grounding.py`, replace the whole `ClaimAuditor` class:

```python
# Cosine threshold for the batch fallback. Measured on Vietnamese claims
# against their English sources: faithful pairs scored 0.29 and 0.62, an
# unrelated control 0.02.
FALLBACK_THRESHOLD = 0.2

_FALLBACK_MIN_CLAIMS = 3
_FALLBACK_MAX_GROUNDED_FRAC = 0.3


class ClaimAuditor:
    """Decides which claims are actually supported by their cited source.

    Quote matching is the primary signal. A claim without a usable quote
    falls back to the legacy lexical check, which still works when claim and
    source share a language.

    If the quote signal collapses across the whole batch — a model that
    paraphrased instead of copying — that is evidence the *signal* is
    unusable, not that every claim is fabricated. In that case an injected
    semantic scorer re-decides. The scorer is injected rather than imported
    so this module stays pure and testable without network access.
    """

    def __init__(
        self,
        threshold: float = 0.12,
        quote_threshold: float = QUOTE_THRESHOLD,
        fallback_scorer=None,
    ):
        self._threshold       = threshold
        self._quote_threshold = quote_threshold
        self._fallback_scorer = fallback_scorer

    def verify(self, claims: list[Claim], sources: list[SearchResult]) -> list[Claim]:
        by_id = {s.id: s.content for s in sources}
        cited_texts = {
            id(c): [by_id[sid] for sid in c.source_ids if sid in by_id] for c in claims
        }

        for c in claims:
            cited = cited_texts[id(c)]
            if c.quote:
                c.grounded = any(
                    quote_support(c.quote, src) >= self._quote_threshold for src in cited
                )
            else:
                c.grounded = is_grounded(c.text, cited, self._threshold)

        if self._should_fall_back(claims):
            self._apply_fallback(claims, cited_texts)

        for c in claims:
            if not c.grounded and c.evidence_type == "direct":
                c.evidence_type = "uncertain"   # gán bảo thủ
        return claims

    def _should_fall_back(self, claims: list[Claim]) -> bool:
        if self._fallback_scorer is None or len(claims) < _FALLBACK_MIN_CLAIMS:
            return False
        grounded_frac = sum(1 for c in claims if c.grounded) / len(claims)
        return grounded_frac < _FALLBACK_MAX_GROUNDED_FRAC

    def _apply_fallback(self, claims: list[Claim], cited_texts: dict) -> None:
        pairs = [(c.text, " ".join(cited_texts[id(c)])) for c in claims]
        try:
            scores = self._fallback_scorer(pairs)
        except Exception as e:  # noqa: BLE001 — keep the quote verdicts
            logger.warning("[GROUNDING] fallback scorer failed (non-fatal): %s", e)
            return
        if not scores or len(scores) != len(claims):
            logger.warning(
                "[GROUNDING] fallback scorer returned %d scores for %d claims — ignoring",
                len(scores or []), len(claims),
            )
            return
        logger.info(
            "[GROUNDING] quote signal unusable across %d claims — re-verified semantically",
            len(claims),
        )
        for c, score in zip(claims, scores):
            c.grounded = score >= FALLBACK_THRESHOLD
```

- [ ] **Step 5: Parse `quote` in `extract_claims`**

In the same file, inside `extract_claims`, after the `et` assignment, replace the append:

```python
        et = str(item.get("evidence_type", "uncertain")).lower()
        if et not in _EVIDENCE_TYPES:
            et = "uncertain"
        quote = str(item.get("quote", "") or "").strip()[:400]
        claims.append(Claim(
            text=text, source_ids=source_ids, evidence_type=et, quote=quote,
        ))
```

- [ ] **Step 6: Ask for the quote in the prompt**

In `backend/app/features/research/prompts.py`, replace `claim_extraction_prompt`:

```python
def claim_extraction_prompt(query: str, numbered_sources: str) -> str:
    return (
        f"{UNTRUSTED_GUARD}\n\n"
        f"From the sources below, extract up to 8 factual claims that answer: {query}\n\n"
        f"Sources:\n{numbered_sources}\n\n"
        f'Return ONLY a JSON array. Each item: '
        f'{{"text": "the claim", "source_id": <source number>, '
        f'"quote": "the exact sentence from that source that supports it", '
        f'"evidence_type": "direct|inference|opinion|uncertain"}}\n'
        f"Use the source number that best supports each claim. Do not invent a "
        f"claim that isn't actually stated in the numbered sources.\n"
        f"The \"quote\" field must be COPIED VERBATIM from the numbered source you "
        f"cite — same wording, same language as the source, do not translate it, "
        f"do not paraphrase it, do not shorten it below one full sentence. It is "
        f"checked character by character against the source.\n\n"
        f"Write the \"text\" field — and ONLY that field — following this rule:\n"
        f"{_footer(LANGUAGE_RULE)}"
    )
```

- [ ] **Step 7: Run tests**

Run: `.venv/Scripts/python.exe -m pytest tests/test_claim_auditor.py tests/test_grounding_llm.py tests/test_models_grounding.py -v`

Expected: PASS, all.

- [ ] **Step 8: Commit**

```bash
git add backend/app/features/research/models.py backend/app/features/research/grounding.py backend/app/features/research/prompts.py tests/test_claim_auditor.py
git commit -m "feat(research): verify claims by verbatim quote with semantic batch fallback"
```

---

### Task 5: Wire the embedding fallback and surface quotes

**Files:**
- Modify: `backend/app/features/research/synthesizer.py`, `agent.py`
- Modify: `frontend/src/components/research/ResearchResult.tsx`

**Interfaces:**
- Consumes: `ClaimAuditor(fallback_scorer=...)`, `Claim.quote` (Task 4).
- Produces: `embedding_pair_scores(pairs: list[tuple[str, str]]) -> list[float]` in `synthesizer.py`; `quote` present in each entry of the `done` event's `claims` array.

- [ ] **Step 1: Add the scorer**

In `backend/app/features/research/synthesizer.py`, add above the `Synthesizer` class:

```python
def embedding_pair_scores(pairs: list[tuple[str, str]]) -> list[float]:
    """Cosine similarity per (claim_text, cited_source_text) pair.

    Injected into ClaimAuditor as its batch fallback so grounding.py keeps
    no dependency on embeddings. Returns [] on any failure — the auditor
    then keeps its quote-based verdicts rather than guessing.
    """
    if not pairs:
        return []
    try:
        import numpy as np
        from backend.app.features.research.embeddings import embed_texts

        flat = [t for pair in pairs for t in pair]
        vecs = np.array(embed_texts(flat))
        vecs = vecs / (np.linalg.norm(vecs, axis=1, keepdims=True) + 1e-9)
        return [float(vecs[2 * i] @ vecs[2 * i + 1]) for i in range(len(pairs))]
    except Exception as e:  # noqa: BLE001
        logger.warning("embedding_pair_scores failed (non-fatal): %s", e)
        return []
```

- [ ] **Step 2: Use it in `_attach_grounding`**

In the same file, in `_attach_grounding`, replace the `ClaimAuditor()` call:

```python
            claims = ClaimAuditor(fallback_scorer=embedding_pair_scores).verify(claims, sources)
```

- [ ] **Step 3: Emit `quote` in the SSE payload**

In `backend/app/features/research/agent.py`, in the `done` event's claims comprehension, add the field:

```python
                    "claims": [
                        {
                            "text":          c.text,
                            "quote":         c.quote,
                            "source_ids":    c.source_ids,
                            "evidence_type": c.evidence_type,
                        }
                        for c in output.claims
                    ],
```

- [ ] **Step 4: Render the quote in the UI**

In `frontend/src/components/research/ResearchResult.tsx`, extend the `Claim` type with `quote?: string` and render it beneath the claim text inside the existing `.claims-list` block:

```tsx
{claims.map((c, i) => (
  <div className="claim-item" key={i}>
    <div className="claim-text">{c.text}</div>
    {c.quote && <blockquote className="claim-quote">{c.quote}</blockquote>}
  </div>
))}
```

Add to `frontend/src/styles/research.css`:

```css
.claim-quote {
  margin: 4px 0 0 12px;
  padding-left: 10px;
  border-left: 2px solid var(--glass-border, rgba(255,255,255,.25));
  font-size: .85em;
  opacity: .75;
  font-style: italic;
}
```

Match the existing markup in that block — if the current code renders claims differently, adapt rather than replace wholesale.

- [ ] **Step 5: Run the suite**

Run: `.venv/Scripts/python.exe -m pytest tests -q`

Expected: `449 passed, 4 failed` (the pre-existing `test_news_fetcher.py` failures) or better.

Run: `cd frontend && npm run build`

Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add backend/app/features/research/synthesizer.py backend/app/features/research/agent.py frontend/src/components/research/ResearchResult.tsx frontend/src/styles/research.css
git commit -m "feat(research): wire semantic grounding fallback and show source quotes"
```

---

### Task 6: Model capability table

**Files:**
- Modify: `backend/app/core/llm.py`
- Test: `tests/test_model_capabilities.py` (create)

**Interfaces:**
- Produces:
  - `ModelCapabilities(context_window: int, supports_structured_output: bool, supports_temperature: bool, reasoning_effort_levels: tuple[str, ...] = ())` — frozen dataclass.
  - `MODEL_CAPABILITIES: dict[str, ModelCapabilities]`
  - `_resolve_model(provider: str, model: str | None) -> str`
  - `capabilities_for(provider: str | None = None, model: str | None = None) -> ModelCapabilities`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_model_capabilities.py`:

```python
# tests/test_model_capabilities.py
import backend.app.core.llm as llm_mod
from backend.app.core.llm import capabilities_for


def test_known_model_capabilities():
    caps = capabilities_for("openai", "gpt-5.6-luna")
    assert caps.context_window == 1_050_000
    assert caps.supports_structured_output is True
    assert caps.supports_temperature is False
    assert "high" in caps.reasoning_effort_levels


def test_unknown_model_falls_back_to_conservative_default():
    caps = capabilities_for("ollama", "some-random-local-model")
    assert caps.context_window == 8192
    assert caps.supports_structured_output is False
    assert caps.supports_temperature is True
    assert caps.reasoning_effort_levels == ()


def test_capabilities_resolve_through_default_model(monkeypatch):
    monkeypatch.setattr(llm_mod.settings, "DEFAULT_PROVIDER", "openai")
    monkeypatch.setattr(llm_mod.settings, "DEFAULT_MODEL", "gpt-5.6-luna")
    assert capabilities_for().context_window == 1_050_000


def test_capabilities_ignore_default_model_of_another_provider(monkeypatch):
    monkeypatch.setattr(llm_mod.settings, "DEFAULT_PROVIDER", "openai")
    monkeypatch.setattr(llm_mod.settings, "DEFAULT_MODEL", "gpt-5.6-luna")
    caps = capabilities_for("anthropic")
    assert caps.context_window == 200_000


def test_resolve_model_matches_get_llm_defaults(monkeypatch):
    monkeypatch.setattr(llm_mod.settings, "DEFAULT_PROVIDER", "ollama")
    monkeypatch.setattr(llm_mod.settings, "DEFAULT_MODEL", None)
    monkeypatch.setattr(llm_mod.settings, "OLLAMA_MODEL", "llama3")
    assert llm_mod._resolve_model("ollama", None) == "llama3"
    assert llm_mod._resolve_model("openai", None) == "gpt-4o-mini"
    assert llm_mod._resolve_model("anthropic", None) == "claude-sonnet-5"
    assert llm_mod._resolve_model("openai", "gpt-4o") == "gpt-4o"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_model_capabilities.py -v`

Expected: FAIL — `ImportError: cannot import name 'capabilities_for'`.

- [ ] **Step 3: Implement**

In `backend/app/core/llm.py`, add after `MODEL_REGISTRY`:

```python
@dataclass(frozen=True)
class ModelCapabilities:
    """What a model can actually do. Callers ask this instead of hardcoding
    limits for whichever model happened to be configured when they were
    written — see synthesizer.py, whose context budgets were sized for
    Llama3 8B and starved every larger model that followed."""
    context_window: int
    supports_structured_output: bool
    supports_temperature: bool
    reasoning_effort_levels: tuple[str, ...] = ()


# Unknown models get the conservative option on every axis: assume a small
# window, assume no structured output, assume temperature works.
DEFAULT_CAPABILITIES = ModelCapabilities(
    context_window=8192, supports_structured_output=False, supports_temperature=True,
)

_LUNA_EFFORTS = ("none", "low", "medium", "high", "xhigh", "max")

MODEL_CAPABILITIES: dict[str, ModelCapabilities] = {
    # supports_temperature=False is measured, not assumed: langchain_openai
    # silently drops any value other than 1.0 for this model.
    "gpt-5.6-luna":  ModelCapabilities(1_050_000, True, False, _LUNA_EFFORTS),
    "gpt-4.1-mini":  ModelCapabilities(1_047_576, True, True),
    "gpt-4o":        ModelCapabilities(128_000, True, True),
    "gpt-4o-mini":   ModelCapabilities(128_000, True, True),
    "claude-opus-4-8":            ModelCapabilities(200_000, True, True),
    "claude-sonnet-5":            ModelCapabilities(200_000, True, True),
    "claude-haiku-4-5-20251001":  ModelCapabilities(200_000, True, True),
}
```

Add `from dataclasses import dataclass` to the imports at the top of the file.

Then add, above `get_llm`:

```python
def _resolve_model(provider: str, model: str | None) -> str:
    """The model id `get_llm` would actually use, for a given provider.

    Extracted so `capabilities_for` cannot drift from `get_llm` — the two
    answering differently is exactly how a budget gets computed for one model
    while the call is made against another.
    """
    resolved = model or _default_model_for(provider)
    if resolved:
        return resolved
    if provider == "ollama":
        return settings.OLLAMA_MODEL
    if provider == "anthropic":
        return "claude-sonnet-5"
    return "gpt-4o-mini"


def capabilities_for(
    provider: str | None = None, model: str | None = None,
) -> ModelCapabilities:
    provider = (provider or settings.DEFAULT_PROVIDER).lower()
    return MODEL_CAPABILITIES.get(_resolve_model(provider, model), DEFAULT_CAPABILITIES)
```

- [ ] **Step 4: Make `get_llm` use `_resolve_model`**

Replace the three per-provider branches' model expressions in `get_llm` so the defaults live in one place:

```python
def get_llm(
    provider: str | None = None,
    model: str | None = None,
    temperature: float = 0.1,
) -> BaseChatModel:
    provider = (provider or settings.DEFAULT_PROVIDER).lower()
    if provider not in ("ollama", "anthropic", "openai"):
        raise ValueError(f"Provider không hỗ trợ: {provider!r}")
    model = _resolve_model(provider, model)

    if provider == "ollama":
        from langchain_ollama import ChatOllama
        return ChatOllama(
            model=model,
            base_url=settings.OLLAMA_URL,
            temperature=temperature,
            num_gpu=settings.LLM_NUM_GPU,
        )

    if provider == "anthropic":
        if not settings.ANTHROPIC_API_KEY:
            raise ValueError("ANTHROPIC_API_KEY chưa cấu hình — không dùng được Claude.")
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            model=model,
            api_key=settings.ANTHROPIC_API_KEY,
            temperature=temperature,
        )

    if not settings.OPENAI_API_KEY:
        raise ValueError("OPENAI_API_KEY chưa cấu hình — không dùng được OpenAI.")
    from langchain_openai import ChatOpenAI
    return ChatOpenAI(
        model=model,
        api_key=settings.OPENAI_API_KEY,
        base_url=settings.OPENAI_BASE_URL,
        temperature=temperature,
    )
```

Note the unknown-provider check moved **before** model resolution, so `get_llm(provider="nope")` still raises `ValueError` as `test_get_llm_unknown_provider_raises` expects.

- [ ] **Step 5: Run tests**

Run: `.venv/Scripts/python.exe -m pytest tests/test_model_capabilities.py tests/test_llm.py tests/test_api_models.py -v`

Expected: PASS, all.

- [ ] **Step 6: Commit**

```bash
git add backend/app/core/llm.py tests/test_model_capabilities.py
git commit -m "feat(llm): add model capability table and single model resolution path"
```

---

### Task 7: Context budget from capabilities

**Files:**
- Modify: `backend/app/features/research/synthesizer.py`, `agent.py`
- Test: `tests/test_model_capabilities.py` (extend)

**Interfaces:**
- Consumes: `ModelCapabilities`, `capabilities_for` (Task 6).
- Produces: `ContextBudget(max_chars: int, per_source_chars: int)` and `budget_for(caps: ModelCapabilities) -> ContextBudget` in `synthesizer.py`; `Synthesizer(llm=None, capabilities=None)`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_model_capabilities.py`:

```python
from backend.app.core.llm import ModelCapabilities, capabilities_for as _cf
from backend.app.features.research.synthesizer import budget_for


def test_budget_for_large_context_model_is_capped_at_60k_tokens():
    b = budget_for(_cf("openai", "gpt-5.6-luna"))
    assert b.max_chars == 210_000          # min(1_050_000*0.5, 60_000) * 3.5
    assert b.per_source_chars == 14_000    # 210_000 // 15


def test_budget_for_small_context_model_stays_small():
    b = budget_for(ModelCapabilities(8192, False, True))
    assert b.max_chars == 14_336           # 8192*0.5 = 4096 tokens * 3.5
    assert b.per_source_chars == 955


def test_budget_per_source_never_degenerates():
    b = budget_for(ModelCapabilities(1024, False, True))
    assert b.per_source_chars >= 200
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_model_capabilities.py -v -k budget`

Expected: FAIL — `ImportError: cannot import name 'budget_for'`.

- [ ] **Step 3: Implement the budget**

In `backend/app/features/research/synthesizer.py`, **delete** these four constants:

```python
_CTX_SUMMARY = 7000
_CTX_POINTS  = 5000
_CTX_CMP     = 3500
_CTX_CHART   = 2500
```

Replace with:

```python
# Context budget is derived from the configured model, not hardcoded. The
# constants above were sized for "Llama3 8B có context 8k tokens" and starved
# every larger model that followed: each source was truncated to 900 chars
# after the pipeline spent a crawl, a dedup pass and a rerank producing 15
# sources of up to 8000 chars each.
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
```

Add `from dataclasses import dataclass` to the imports.

- [ ] **Step 4: Use the budget in `Synthesizer`**

Replace `Synthesizer.__init__`:

```python
    def __init__(self, llm=None, capabilities=None):
        from backend.app.core.llm import capabilities_for
        self.llm    = llm or get_llm()
        self.caps   = capabilities or capabilities_for()
        self.budget = budget_for(self.caps)
```

Replace `_ctx` so `per_source` defaults to the budget:

```python
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
```

In `_run_sections`, replace the four `self._ctx(ranked, _CTX_*)` calls with `self._ctx(ranked)`.

In `synthesize_rag`, replace `self._ctx(sources, max_chars=6500, per_source=1300)` with `self._ctx(sources)`.

In `_make_comparison_table`, remove the `[:4]` and `[:200]` caps:

```python
        src_text = "\n".join(
            f"{i+1}. [{s.source}] {s.title}: "
            f"{frame_untrusted(s.content[:self.budget.per_source_chars].replace(chr(10), ' '))}"
            for i, s in enumerate(sources)
        )
```

- [ ] **Step 5: Pass capabilities from the agent**

In `backend/app/features/research/agent.py`, in `_run_core`, replace the per-request synthesizer construction:

```python
            if provider or model:
                from backend.app.core.llm import capabilities_for, get_llm
                synth = Synthesizer(
                    get_llm(provider, model), capabilities_for(provider, model),
                )
            else:
                synth = self.synth
```

- [ ] **Step 6: Run tests**

Run: `.venv/Scripts/python.exe -m pytest tests -q`

Expected: `449 passed, 4 failed` or better. If `tests/test_synthesize_grounded.py` references the deleted constants, update it to use `budget_for` instead.

- [ ] **Step 7: Commit**

```bash
git add backend/app/features/research/synthesizer.py backend/app/features/research/agent.py tests/test_model_capabilities.py
git commit -m "feat(research): derive context budget from model capabilities"
```

---

### Task 8: Structured output with reasoning effort

**Files:**
- Create: `backend/app/features/research/output_schemas.py`
- Modify: `backend/app/features/research/synthesizer.py`, `prompts.py`
- Test: `tests/test_structured_output.py` (create)

**Interfaces:**
- Consumes: `self.caps` (Task 7).
- Produces: `Synthesizer._call(prompt, effort=None) -> str` and `Synthesizer._call_structured(prompt, schema, effort=None) -> BaseModel | None`.

Verified on the installed stack (`langchain-openai` 1.3.3): `llm.bind(reasoning_effort="low").with_structured_output(Schema).invoke(prompt)` returns a validated model instance from `gpt-5.6-luna`.

- [ ] **Step 1: Write the schemas**

Create `backend/app/features/research/output_schemas.py`:

```python
"""Pydantic schemas for LLM structured output.

Separate from schemas.py, which holds the HTTP request/response models —
these never cross the API boundary, they only shape what the model returns.

The five-strategy JSON repair ladder in synthesizer._parse_obj is NOT
retired by these: Ollama/llama3 has no structured output, so that ladder
remains the fallback path.
"""
from pydantic import BaseModel, Field


class SummaryShortMedium(BaseModel):
    short:  str = Field(description="A 2-3 sentence summary of the main topic and key insight")
    medium: str = Field(description="A 2-paragraph overview of context, methods, and findings")


class KeyPoints(BaseModel):
    points: list[str] = Field(
        description=(
            "8 key findings. Each starts with exactly one tag: [FINDING] [METHOD] "
            "[DATA] [TREND] [LIMITATION] [DEFINITION], then at least 15 words."
        )
    )


class ComparisonRow(BaseModel):
    source:     str
    type:       str
    main_claim: str
    strength:   str
    limitation: str


class ComparisonTable(BaseModel):
    rows: list[ComparisonRow]


class ChartData(BaseModel):
    has_data: bool = Field(description="False when the sources contain no comparable numbers")
    type:     str  = Field(default="bar")
    title:    str  = Field(default="")
    labels:   list[str]   = Field(default_factory=list)
    values:   list[float] = Field(default_factory=list)
    unit:     str  = Field(default="")


class FollowUps(BaseModel):
    questions: list[str] = Field(description="4 follow-up research questions, each ending in '?'")


class ExtractedClaim(BaseModel):
    text:          str
    source_id:     int
    quote:         str = Field(description="Verbatim excerpt copied from the cited source")
    evidence_type: str = Field(description="one of: direct, inference, opinion, uncertain")


class Claims(BaseModel):
    claims: list[ExtractedClaim]
```

- [ ] **Step 2: Write the failing tests**

Create `tests/test_structured_output.py`:

```python
# tests/test_structured_output.py
from backend.app.core.llm import ModelCapabilities
from backend.app.features.research.output_schemas import SummaryShortMedium
from backend.app.features.research.synthesizer import Synthesizer


class _FakeStructured:
    def __init__(self, result):
        self._result = result

    def invoke(self, prompt):
        if isinstance(self._result, Exception):
            raise self._result
        return self._result


class _FakeLLM:
    def __init__(self, structured_result=None, text="SUMMARY: s\nOVERVIEW: m"):
        self._structured = structured_result
        self._text = text
        self.bind_calls = []

    def bind(self, **kwargs):
        self.bind_calls.append(kwargs)
        return self

    def with_structured_output(self, schema):
        return _FakeStructured(self._structured)

    def invoke(self, prompt):
        class _R:
            content = self._text
        return _R()


def _synth(llm, caps):
    return Synthesizer(llm=llm, capabilities=caps)


_STRUCTURED_CAPS = ModelCapabilities(200_000, True, True, ("low", "medium", "high"))
_PLAIN_CAPS      = ModelCapabilities(8192, False, True)


def test_structured_path_returns_parsed_model():
    want = SummaryShortMedium(short="s", medium="m")
    s = _synth(_FakeLLM(structured_result=want), _STRUCTURED_CAPS)
    got = s._call_structured("p", SummaryShortMedium)
    assert got.short == "s"


def test_structured_path_skipped_when_capability_absent():
    s = _synth(_FakeLLM(structured_result=SummaryShortMedium(short="s", medium="m")), _PLAIN_CAPS)
    assert s._call_structured("p", SummaryShortMedium) is None


def test_structured_failure_returns_none_so_caller_falls_back():
    s = _synth(_FakeLLM(structured_result=ValueError("schema violation")), _STRUCTURED_CAPS)
    assert s._call_structured("p", SummaryShortMedium) is None


def test_effort_is_bound_only_when_model_supports_it():
    llm = _FakeLLM(structured_result=SummaryShortMedium(short="s", medium="m"))
    _synth(llm, _STRUCTURED_CAPS)._call_structured("p", SummaryShortMedium, effort="high")
    assert {"reasoning_effort": "high"} in llm.bind_calls

    llm2 = _FakeLLM()
    _synth(llm2, _PLAIN_CAPS)._call("p", effort="high")
    assert llm2.bind_calls == []


def test_unsupported_effort_level_is_not_bound():
    llm = _FakeLLM()
    _synth(llm, _STRUCTURED_CAPS)._call("p", effort="xhigh")   # not in ("low","medium","high")
    assert llm.bind_calls == []
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_structured_output.py -v`

Expected: FAIL — `AttributeError: 'Synthesizer' object has no attribute '_call_structured'`.

- [ ] **Step 4: Implement the call layer**

In `backend/app/features/research/synthesizer.py`, replace `_call` and add `_call_structured`:

```python
    def _bound(self, effort: str | None):
        """The LLM with reasoning effort applied, when the model supports it.

        Call sites always pass their intended effort; models that don't have
        the knob simply ignore it here, so no call site branches on model.
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
        """Return a validated schema instance, or None to signal "use the
        text fallback". Never raises: a schema violation must degrade to the
        legacy parse path, not fail the section."""
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
```

Add the small helper above the class (the existing `_call` assumed `.content` is a string; Anthropic returns content blocks):

```python
def _content_or_str(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            b if isinstance(b, str) else b.get("text", "")
            for b in content if isinstance(b, (str, dict))
        )
    return str(content or "")
```

- [ ] **Step 5: Migrate the sections**

Rewrite each maker to try structured first and keep the existing body as fallback. `_make_summaries`:

```python
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
```

`_make_key_points` — prepend before the existing parsing:

```python
    def _make_key_points(self, query: str, ctx: str, out: ResearchOutput) -> None:
        parsed = self._call_structured(
            prompts.key_points_prompt(query, ctx), output_schemas.KeyPoints, "medium",
        )
        if parsed is not None:
            out.key_points = [p.strip() for p in parsed.points if len(p.strip()) > 15]
            logger.info("Key points: %d (structured)", len(out.key_points))
            return
        raw = self._call(prompts.key_points_prompt(query, ctx), "medium")
        # ... existing regex parsing and its two fallbacks, unchanged ...
```

`_make_comparison_table` — after building `src_text`:

```python
        parsed = self._call_structured(
            prompts.comparison_table_prompt(query, src_text),
            output_schemas.ComparisonTable, "medium",
        )
        if parsed is not None:
            out.comparison_table = [r.model_dump() for r in parsed.rows]
            logger.info("Comparison: %d rows (structured)", len(out.comparison_table))
            return
        raw = self._call(prompts.comparison_table_prompt(query, src_text), "medium")
        parsed_rows = self._parse_array(raw)
        valid = [r for r in parsed_rows if isinstance(r, dict) and "source" in r and "main_claim" in r]
        out.comparison_table = valid
        logger.info("Comparison: %d rows", len(out.comparison_table))
```

Note the metadata-fabricated fallback is gone — Task 10 covers why.

`_make_chart_data`:

```python
    def _make_chart_data(self, query: str, ctx: str, out: ResearchOutput) -> None:
        parsed = self._call_structured(
            prompts.chart_data_prompt(query, ctx), output_schemas.ChartData, "low",
        )
        if parsed is not None:
            if parsed.has_data and parsed.labels and parsed.values:
                out.chart_data = parsed.model_dump(exclude={"has_data"})
                logger.info("Chart: %s (structured)", out.chart_data.get("title", ""))
            return
        raw = self._call(prompts.chart_data_prompt(query, ctx), "low").strip()
        if raw and "NO_DATA" not in raw.upper():
            chart = self._parse_obj(raw)
            if chart and "labels" in chart and "values" in chart:
                out.chart_data = chart
                logger.info("Chart: %s", chart.get("title", ""))
```

`_make_follow_up_questions` — takes `ctx` now (Task 9 changes the prompt; wire the parameter here):

```python
    def _make_follow_up_questions(self, query: str, ctx: str, out: ResearchOutput) -> None:
        parsed = self._call_structured(
            prompts.follow_up_questions_prompt(query, ctx),
            output_schemas.FollowUps, "low",
        )
        if parsed is not None:
            out.follow_up_questions = [q.strip() for q in parsed.questions if "?" in q][:4]
            logger.info("Follow-up questions: %d (structured)", len(out.follow_up_questions))
            return
        raw = self._call(prompts.follow_up_questions_prompt(query, ctx), "low")
        # ... existing parsing, unchanged ...
```

Update the `steps` list in `_run_sections` so `follow_ups` receives the context:

```python
        ctx = self._ctx(ranked)
        steps = [
            ("summaries",    self._make_summaries,           (query, ctx, out)),
            ("key_points",   self._make_key_points,          (query, ctx, out)),
            ("comparison",   self._make_comparison_table,    (query, ranked, out)),
            ("chart",        self._make_chart_data,          (query, ctx, out)),
            ("follow_ups",   self._make_follow_up_questions, (query, ctx, out)),
            ("papers",       self._make_papers_and_refs,     (ranked, out)),
        ]
```

Building `ctx` once instead of four times also removes three redundant passes over the sources.

`extract_claims` in `grounding.py` stays as-is (it takes injected callables); route it through the structured path from `_attach_grounding` instead:

```python
    def _attach_grounding(self, out: ResearchOutput, query: str, sources: list[SearchResult]) -> None:
        if not getattr(settings, "RESEARCH_GROUNDING_ENABLED", True) or not sources:
            return
        try:
            claims = extract_claims(
                query, sources,
                lambda p: self._call(p, "high"),
                self._parse_array,
                structured_call=lambda p: self._call_structured(
                    p, output_schemas.Claims, "high",
                ),
            )
            claims = ClaimAuditor(fallback_scorer=embedding_pair_scores).verify(claims, sources)
            out.claims      = [c for c in claims if c.grounded]
            out.confidence  = compute_confidence(claims, len(sources))
            out.limitations = derive_limitations(sources, claims)
        except Exception as e:
            logger.error("Grounding failed (non-fatal): %s", e, exc_info=True)
```

And in `grounding.extract_claims`, accept the optional structured path while staying free of any LLM import:

```python
def extract_claims(query, sources, llm_call, parse_array, structured_call=None) -> list[Claim]:
    """`structured_call` is an injected callable returning an object with a
    `.claims` list of items carrying text/source_id/quote/evidence_type, or
    None to use the text path. Injected, not imported, so this module stays
    pure."""
    if not sources:
        return []
    parsed = None
    if structured_call is not None:
        try:
            result = structured_call(claim_extraction_prompt(query, _numbered_sources(sources)))
            if result is not None:
                parsed = [item.model_dump() for item in result.claims]
        except Exception as e:  # noqa: BLE001
            logger.warning("structured claim extraction failed (non-fatal): %s", e)
    if parsed is None:
        try:
            raw = llm_call(claim_extraction_prompt(query, _numbered_sources(sources)))
            parsed = parse_array(raw)
        except Exception as e:  # noqa: BLE001
            logger.warning("extract_claims failed (non-fatal): %s", e)
            return []
    # ... existing per-item validation loop, unchanged ...
```

Add `from backend.app.features.research import output_schemas` to the synthesizer imports.

- [ ] **Step 6: Add `NO_DATA` guidance to the chart prompt for the fallback path**

`prompts.chart_data_prompt` is unchanged — it already handles both. Leave it.

- [ ] **Step 7: Run tests**

Run: `.venv/Scripts/python.exe -m pytest tests -q`

Expected: `449 passed, 4 failed` or better.

Then a live smoke check:

```bash
PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe -c "
from backend.app.features.research.synthesizer import Synthesizer
from backend.app.features.research.models import SearchResult
s = Synthesizer()
src = [SearchResult(source='web', title='Diffusion', url='http://x',
       content='Diffusion models are increasingly replacing GANs for image synthesis due to better mode coverage.')]
out = s.synthesize_grounded('mo hinh khuech tan la gi', src)
print('claims:', len(out.claims), 'confidence:', out.confidence)
for c in out.claims: print(' -', c.text[:60], '||', c.quote[:60])
"
```

Expected: at least one grounded claim with a non-empty quote, and a non-zero confidence. This is the first end-to-end proof the grounding repair works.

- [ ] **Step 8: Commit**

```bash
git add backend/app/features/research/output_schemas.py backend/app/features/research/synthesizer.py backend/app/features/research/grounding.py tests/test_structured_output.py
git commit -m "feat(research): structured output with per-call-site reasoning effort"
```

---

### Task 9: Iteration steered by real evidence gaps

**Files:**
- Modify: `backend/app/features/research/iteration.py`, `prompts.py`, `agent.py`
- Test: `tests/test_iteration_pure.py` (extend)

**Interfaces:**
- Consumes: `Claim.quote`/`Claim.grounded` (Task 4).
- Produces: `gap_query(query: str, output: ResearchOutput, missing: str | None = None, ungrounded: list[str] | None = None) -> str | None`; `prompts.follow_up_questions_prompt(query: str, ctx: str) -> str`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_iteration_pure.py`:

```python
from backend.app.features.research.iteration import gap_query
from backend.app.features.research.models import ResearchOutput


def test_gap_query_prefers_judge_missing():
    out = ResearchOutput(query="q", follow_up_questions=["Invented question?"])
    assert gap_query("q", out, missing="FLOPs benchmark numbers") == "FLOPs benchmark numbers"


def test_gap_query_uses_ungrounded_claims_when_no_missing():
    out = ResearchOutput(query="q", follow_up_questions=["Invented question?"])
    got = gap_query("q", out, ungrounded=["throughput on A100 is 3x higher"])
    assert got == "throughput on A100 is 3x higher"


def test_gap_query_falls_back_to_follow_up_question():
    out = ResearchOutput(query="q", follow_up_questions=["What about limitations?"])
    assert gap_query("q", out) == "What about limitations?"


def test_gap_query_final_fallback_is_anchored_to_query():
    out = ResearchOutput(query="q")
    assert gap_query("diffusion models", out) == "diffusion models evidence details"


def test_gap_query_truncates_to_200_chars():
    out = ResearchOutput(query="q")
    assert len(gap_query("q", out, missing="x" * 500)) == 200


def test_gap_query_ignores_blank_signals():
    out = ResearchOutput(query="q", follow_up_questions=["Real question?"])
    assert gap_query("q", out, missing="   ", ungrounded=["", "  "]) == "Real question?"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_iteration_pure.py -v -k gap_query`

Expected: FAIL — `TypeError: gap_query() got an unexpected keyword argument 'missing'`.

- [ ] **Step 3: Implement**

Replace `gap_query` in `backend/app/features/research/iteration.py`:

```python
def gap_query(
    query: str,
    output: ResearchOutput,
    missing: str | None = None,
    ungrounded: list[str] | None = None,
) -> str | None:
    """Query for the supplementary search round, in order of evidential value.

    The follow-up question used to come first, but it is generated without
    the model having seen any source (prompts.follow_up_questions_prompt) —
    so the top-up search was steered by an invention. The real gap is
    already known: the judge names it, and failed claims mark exactly where
    evidence is thin. Both now outrank the invented question.

    Pure. The caller anchors the result to the user's query via
    sufficiency.anchor_gap_query.
    """
    if missing and missing.strip():
        return missing.strip()[:200]

    for claim_text in (ungrounded or []):
        if claim_text and claim_text.strip():
            return claim_text.strip()[:200]

    if output.follow_up_questions:
        fq = output.follow_up_questions[0].strip()
        if fq:
            return fq[:200]

    q = query.strip()
    if not q:
        return None
    return f"{q} evidence details"[:200]
```

- [ ] **Step 4: Give follow-up questions the sources**

In `backend/app/features/research/prompts.py`, replace `follow_up_questions_prompt`:

```python
def follow_up_questions_prompt(query: str, ctx: str) -> str:
    return (
        f"Sources:\n{ctx}\n\n"
        f"Suggest 4 follow-up research questions about '{query}'.\n"
        f"Base them on what the sources above actually cover and, especially, "
        f"on what they leave unanswered — a question the sources already "
        f"answer is not a follow-up.\n"
        f'Return ONLY a JSON array: ["Q1?", "Q2?", "Q3?", "Q4?"]\n\n'
        f"{_footer(LANGUAGE_RULE)}"
    )
```

- [ ] **Step 5: Thread the real signals through the agent**

In `backend/app/features/research/agent.py`, `_iteration_step` gains the two signals:

```python
    def _iteration_step(self, query, sources, output, synth, missing=None):
        """Một vòng search bù nhắm vào khoảng trống grounding.

        Trả (new_sources, new_output, newly_fetched), hoặc None để dừng.
        """
        ungrounded = [c.text for c in output.claims if not c.grounded]
        gq = gap_query(query, output, missing=missing, ungrounded=ungrounded)
        if not gq:
            return None
        try:
            merged, newly = self._top_up(query, sources, gq)
            new_output = synth.synthesize_grounded(query, merged)
            return merged, new_output, newly
        except Exception as e:  # noqa: BLE001 — non-fatal, giữ output trước đó
            logger.warning("[ITERATION] round failed (non-fatal): %s", e)
            return None
```

`output.claims` holds only grounded claims by the time it reaches here, so also keep the full set. In `Synthesizer._attach_grounding`, store it for this purpose:

```python
            out.claims      = [c for c in claims if c.grounded]
            out.all_claims  = claims
```

Add to `ResearchOutput` in `models.py`:

```python
    # Every extracted claim including the ones that failed verification.
    # Not serialized to the client — used only to steer the iteration round
    # toward where evidence is actually thin.
    all_claims: list[Claim] = field(default_factory=list)
```

And in `_iteration_step` read from it:

```python
        ungrounded = [c.text for c in (output.all_claims or []) if not c.grounded]
```

In `_run_core`, capture the judge's `missing` so the iteration can use it. Where `verdict` is unpacked, keep it:

```python
                    sufficient, missing = verdict
                    judge_missing = missing
```

Initialize `judge_missing = None` next to `decision = reason = None`, and pass it at the call site:

```python
                    step = self._iteration_step(query, all_sources, output, synth,
                                                missing=judge_missing)
```

- [ ] **Step 6: Run tests**

Run: `.venv/Scripts/python.exe -m pytest tests -q`

Expected: `449 passed, 4 failed` or better. Update any test that calls `follow_up_questions_prompt(query)` with one argument.

- [ ] **Step 7: Commit**

```bash
git add backend/app/features/research/iteration.py backend/app/features/research/prompts.py backend/app/features/research/agent.py backend/app/features/research/models.py tests/test_iteration_pure.py
git commit -m "fix(research): steer iteration from judge gaps and failed claims"
```

---

### Task 10: Unify the two rerank paths

**Files:**
- Modify: `backend/app/features/research/reranker.py`, `search/ranking.py`
- Test: `tests/test_reranker.py`, `tests/test_ranking_signals.py` (extend)

**Interfaces:**
- Produces: `fuse_scores(rerank, base, cred, recency=None, citation=None) -> list[float]`; `recency_score(extra, ref_year=None)` additionally reading `extra["published_at"]`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_reranker.py`:

```python
def test_fuse_scores_three_signal_weights():
    out = rr.fuse_scores(rerank=[1.0], base=[1.0], cred=[1.0])
    assert out == [1.0]
    out = rr.fuse_scores(rerank=[1.0], base=[0.0], cred=[0.0])
    assert abs(out[0] - 0.7) < 1e-9


def test_fuse_scores_five_signal_weights():
    out = rr.fuse_scores(rerank=[1.0], base=[1.0], cred=[1.0], recency=[1.0], citation=[1.0])
    assert abs(out[0] - 1.0) < 1e-9
    out = rr.fuse_scores(rerank=[1.0], base=[0.0], cred=[0.0], recency=[0.0], citation=[0.0])
    assert abs(out[0] - 0.55) < 1e-9


def test_fuse_scores_five_signal_without_reranker():
    out = rr.fuse_scores(rerank=None, base=[1.0], cred=[1.0], recency=[1.0], citation=[1.0])
    assert abs(out[0] - 1.0) < 1e-9


def test_fuse_scores_monotonic_in_rerank():
    low  = rr.fuse_scores([0.1], [0.5], [0.5])[0]
    high = rr.fuse_scores([0.9], [0.5], [0.5])[0]
    assert high > low
```

Append to `tests/test_ranking_signals.py`:

```python
import datetime

from backend.app.features.research.search.ranking import recency_score


def test_recency_score_reads_published_at_epoch():
    now_year = datetime.datetime.now(datetime.timezone.utc).year
    epoch = datetime.datetime(now_year, 1, 1, tzinfo=datetime.timezone.utc).timestamp()
    assert recency_score({"published_at": epoch}) > 0.9


def test_recency_score_published_at_does_not_override_explicit_year():
    old = datetime.datetime(2000, 1, 1, tzinfo=datetime.timezone.utc).timestamp()
    assert recency_score({"year": datetime.datetime.now().year, "published_at": old}) > 0.9


def test_recency_score_still_zero_without_any_date():
    assert recency_score({}) == 0.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_reranker.py tests/test_ranking_signals.py -v`

Expected: FAIL — `fuse_scores() got an unexpected keyword argument 'recency'`, and `recency_score({"published_at": ...}) == 0.0`.

- [ ] **Step 3: Extend `fuse_scores`**

Replace it in `backend/app/features/research/reranker.py`:

```python
# Weight sets, both previously duplicated with different numbers in
# search/ranking.py. Neither call site's effective scoring changes here —
# only where the reranker score comes from (ranking.py now uses the
# Cohere → BGE ladder instead of BGE alone).
_W_5 = {"rerank": 0.55, "cred": 0.20, "recency": 0.10, "citation": 0.10, "base": 0.05}
_W_5_NO_RERANK = {"base": 0.40, "cred": 0.35, "citation": 0.15, "recency": 0.10}
_W_3 = {"rerank": 0.70, "cred": 0.20, "base": 0.10}
_W_3_NO_RERANK = {"base": 0.70, "cred": 0.30}


def fuse_scores(
    rerank:   list[float] | None,
    base:     list[float],
    cred:     list[float],
    recency:  list[float] | None = None,
    citation: list[float] | None = None,
) -> list[float]:
    """Blend relevance signals into one score per document.

    Five-signal blend when recency/citation are supplied (live search
    results carry publication dates and citation counts), three-signal
    otherwise (stored chunks do not).
    """
    rich = recency is not None and citation is not None
    out: list[float] = []
    for i in range(len(base)):
        if rich and rerank is not None:
            w = _W_5
            out.append(
                rerank[i] * w["rerank"] + cred[i] * w["cred"]
                + recency[i] * w["recency"] + citation[i] * w["citation"]
                + base[i] * w["base"]
            )
        elif rich:
            w = _W_5_NO_RERANK
            out.append(
                base[i] * w["base"] + cred[i] * w["cred"]
                + citation[i] * w["citation"] + recency[i] * w["recency"]
            )
        elif rerank is not None:
            w = _W_3
            out.append(rerank[i] * w["rerank"] + cred[i] * w["cred"] + base[i] * w["base"])
        else:
            w = _W_3_NO_RERANK
            out.append(base[i] * w["base"] + cred[i] * w["cred"])
    return out
```

- [ ] **Step 4: Teach `recency_score` the epoch shape**

In `backend/app/features/research/search/ranking.py`, replace `recency_score`:

```python
def recency_score(extra: dict, ref_year: int | None = None) -> float:
    """Exponential-decay recency in [0, 1]: exp(-age/5), 0.0 when unknown.

    Accepts three shapes because the pipeline produces three: live academic
    results carry "year" or "published", while knowledge-store chunks carry
    "published_at" as an epoch (knowledge_store._rank_candidates). Reading
    only the first two meant every stored source scored 0.0 regardless of
    how recent it was.
    """
    if ref_year is None:
        ref_year = datetime.now(timezone.utc).year

    # A falsy-but-present "year" (0 or "") intentionally falls through.
    year = extra.get("year") or extra.get("published", "")
    if not year:
        epoch = extra.get("published_at")
        if epoch:
            try:
                year = datetime.fromtimestamp(float(epoch), timezone.utc).year
            except (ValueError, TypeError, OSError, OverflowError):
                return 0.0
    if not year:
        return 0.0
    try:
        age = max(0, ref_year - int(str(year)[:4]))
        return math.exp(-age / 5.0)
    except (ValueError, TypeError):
        return 0.0
```

- [ ] **Step 5: Route `rerank_results` through the shared ladder**

In the same file, replace `rerank_results`:

```python
def rerank_results(
    query:   str,
    results: list[SearchResult],
    top_k:   int = 15,
) -> list[SearchResult]:
    """Rerank with the shared cross-encoder ladder plus credibility, recency
    and citation signals. Falls back to the non-reranked blend when no
    reranker backend is available."""
    if not results:
        return results

    base     = [r.score for r in results]
    cred     = [_CREDIBILITY.get(r.source, 0.5) for r in results]
    recency  = [recency_score(r.extra) for r in results]
    citation = [citation_score(r.extra) for r in results]

    try:
        rerank = cross_encoder_scores(
            query, [f"{r.title} {r.content[:500]}" for r in results]
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("cross_encoder_scores failed (non-fatal): %s", e)
        rerank = None
    if rerank is not None and len(rerank) != len(results):
        logger.warning("Rerank length mismatch (%d vs %d) — ignoring rerank scores",
                       len(rerank), len(results))
        rerank = None

    final = fuse_scores(rerank, base, cred, recency=recency, citation=citation)
    ranked = sorted(zip(results, final), key=lambda x: x[1], reverse=True)
    top = [r for r, _ in ranked[:top_k]]
    logger.info(
        "Reranked %d → top %d results (%s)",
        len(results), len(top), "cross-encoder" if rerank is not None else "credibility fallback",
    )
    return top
```

Change the imports at the top of `ranking.py`:

```python
from backend.app.features.research.reranker import (
    _CREDIBILITY, cross_encoder_scores, fuse_scores,
)
```

and delete the now-unused `_get_reranker` helper.

- [ ] **Step 6: Run tests**

Run: `.venv/Scripts/python.exe -m pytest tests -q`

Expected: `449 passed, 4 failed` or better. Any test asserting the old `rerank_results` internals should be updated to assert ordering behavior, not weights.

- [ ] **Step 7: Commit**

```bash
git add backend/app/features/research/reranker.py backend/app/features/research/search/ranking.py tests/test_reranker.py tests/test_ranking_signals.py
git commit -m "refactor(research): one rerank ladder and one fusion function"
```

---

### Task 11: Remove dead code and move comparison gating to the backend

**Files:**
- Modify: `synthesizer.py`, `agent.py`, `router.py`, `service.py`, `prompts.py`, `search/community.py`, `search/query.py`
- Modify: `frontend/src/components/research/ResearchResult.tsx`
- Modify: `tests/test_security_framing.py`, `tests/test_research_wiring.py`, `tests/contract/test_api_contracts.py`

**Interfaces:**
- Produces: `has_compare_intent(query: str) -> bool` in `search/query.py`, exported through `search/__init__.py`.

- [ ] **Step 1: Write the failing test for comparison gating**

Create `tests/test_compare_intent.py`:

```python
# tests/test_compare_intent.py
from backend.app.features.research.search.query import has_compare_intent


def test_compare_intent_detected_in_vietnamese():
    assert has_compare_intent("so sánh DPO và PPO") is True
    assert has_compare_intent("DPO khác PPO ở điểm nào") is True


def test_compare_intent_detected_in_english():
    assert has_compare_intent("DPO vs PPO") is True
    assert has_compare_intent("difference between RAG and fine-tuning") is True


def test_no_compare_intent_on_plain_question():
    assert has_compare_intent("RAG hoạt động thế nào") is False
    assert has_compare_intent("what is mixture of experts") is False


def test_compare_intent_is_case_insensitive():
    assert has_compare_intent("Compare BERT And GPT") is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/Scripts/python.exe -m pytest tests/test_compare_intent.py -v`

Expected: FAIL — `ImportError: cannot import name 'has_compare_intent'`.

- [ ] **Step 3: Implement the gate**

Add to `backend/app/features/research/search/query.py`:

```python
# Comparison intent. This lived in the frontend (ResearchResult.tsx), which
# meant the backend made the comparison LLM call on every run and the UI
# threw the result away unless the query happened to contain one of these.
# The decision belongs where the call is made.
_COMPARE_KEYWORDS = (
    "vs", "versus", "compare", "comparison", "so sánh", "khác nhau",
    "khác gì", "difference", "differences", "between", "ở điểm nào",
)


def has_compare_intent(query: str) -> bool:
    q = (query or "").lower()
    return any(kw in q for kw in _COMPARE_KEYWORDS)
```

Export it from `backend/app/features/research/search/__init__.py` alongside `expand_query` and `get_dynamic_k`.

- [ ] **Step 4: Gate the call in the synthesizer**

In `_run_sections`, replace the unconditional comparison step:

```python
        steps = [
            ("summaries",    self._make_summaries,           (query, ctx, out)),
            ("key_points",   self._make_key_points,          (query, ctx, out)),
            ("chart",        self._make_chart_data,          (query, ctx, out)),
            ("follow_ups",   self._make_follow_up_questions, (query, ctx, out)),
            ("papers",       self._make_papers_and_refs,     (ranked, out)),
        ]
        if has_compare_intent(query):
            steps.insert(2, ("comparison", self._make_comparison_table, (query, ranked, out)))
```

Import at the top: `from backend.app.features.research.search.query import has_compare_intent`.

Also delete the metadata-fabricated `comparison_table` block in `synthesize_rag` (the same `"See full source for details"` filler), leaving `out.comparison_table` empty there.

- [ ] **Step 5: Drop the frontend gate**

In `frontend/src/components/research/ResearchResult.tsx`, delete `COMPARE_KEYWORDS`, `queryLower`, and `hasCompareIntent`, and change:

```tsx
  const realCompareRows = (result.comparison_table || []).filter(r => r.source && r.main_claim);
  const showCompare = realCompareRows.length >= 2;
```

- [ ] **Step 6: Delete the dead code**

| File | Delete |
|---|---|
| `synthesizer.py` | `Synthesizer.synthesize()`, `Synthesizer.answer()` |
| `prompts.py` | `follow_up_answer_prompt` |
| `agent.py` | `ResearchAgent.run()`, `knowledge_size()`, `clear_knowledge()`, `clear_cache()` |
| `router.py` | `serve_paper` and its `@router.get("/api/paper/{filename}")`, `clear_research_cache` and its `@router.delete("/api/research/cache")`, plus the now-unused `os` import |
| `service.py` | `ResearchService.clear_cache` |
| `synthesizer.py` | the `pdf_filename` sha256 block in `_make_papers_and_refs` (keep `pdf_url` — the UI links it directly) |
| `search/community.py` | `HuggingFaceSearcher._search_models` and the `_MODELS_URL` constant; `search()` becomes `return self._search_papers(query, k)` |

Keep `_QueryCache` and the module-level `_cache` — `_top_up` reads it.

- [ ] **Step 7: Update the tests that exercised removed code**

- `tests/test_security_framing.py`: delete `test_answer_frames_context`. Coverage is preserved by `test_deep_dive_context_frames_client_content` in the same file, which exercises the live deep-dive path.
- `tests/test_research_wiring.py`: delete the two tests calling `agent.run(...)` (around lines 295 and 374). `run_streaming` coverage in the same file is unaffected.
- `tests/contract/test_api_contracts.py`: remove any assertion referencing `/api/paper/` or `DELETE /api/research/cache`.

- [ ] **Step 8: Run the whole suite and the frontend build**

Run: `.venv/Scripts/python.exe -m pytest tests -q`

Expected: 4 failures, all in `tests/test_news_fetcher.py`. Total passed will be lower than 449 because tests for removed code were deleted — that is expected and correct.

Run: `cd frontend && npm run build`

Expected: build succeeds with no unused-variable errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(research): remove uncalled code, gate comparison call in backend"
```

---

### Task 12: Re-measure and compare

**Files:**
- Create: `docs/superpowers/plans/assets/2026-08-18-after.json`

- [ ] **Step 1: Run the probe again**

Run:
```bash
.venv/Scripts/python.exe tools/research_probe.py --out docs/superpowers/plans/assets/2026-08-18-after.json
```

- [ ] **Step 2: Compare against the baseline**

Run:
```bash
PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe -c "
import json
b = json.load(open('docs/superpowers/plans/assets/2026-08-18-baseline.json', encoding='utf-8'))['summary']
a = json.load(open('docs/superpowers/plans/assets/2026-08-18-after.json',   encoding='utf-8'))['summary']
for k in b:
    print(f'{k:28} {b[k]!s:>12} -> {a[k]!s:>12}')
"
```

**Expected direction:**

| Metric | Before | After |
|---|---|---|
| `mean_grounded_fraction` | ~0.0 | substantially above 0 |
| `mean_confidence` | ~0.0 | substantially above 0 |
| `total_iteration_rounds` | one per run | fewer than one per run |
| `mean_ctx_chars` | bounded near 7,000 | far larger |

`mean_wall_seconds` may rise — sending more context and using `high` reasoning effort on two calls costs time. That is an accepted trade, not a regression.

- [ ] **Step 3: Report and record**

If `mean_grounded_fraction` did **not** rise materially, do not declare the work done. Report the numbers, and investigate whether the model is copying quotes verbatim (check logs for `quote signal unusable`) before making further changes.

Append a short results table to the spec under a new `## 13. Results` section, with the before/after numbers.

- [ ] **Step 4: Commit**

```bash
git add -f docs/superpowers/plans/assets/2026-08-18-after.json docs/superpowers/specs/2026-08-18-research-grounding-and-model-fit-design.md
git commit -m "chore(research): record post-change probe results"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §3.1–3.4 quote verification, batch fallback | 2, 4 |
| §3.5 unicode tokenizer + 80% anchor guard | 3 |
| §3.6 quote in SSE, UI display | 5 |
| §4.1 capability table | 6 |
| §4.2 context budget | 7 |
| §4.3 reasoning effort per call site | 8 |
| §5 structured output + fallback ladder | 8 |
| §6 rerank unification + `recency_score` epoch fix | 10 |
| §7 iteration steering | 9 |
| §8 removals + comparison gating | 11 |
| §9 probe, baseline, falsification criterion | 1, 12 |
| §10 testing | every task |
| §11 sequencing | task order |

No spec requirement is unassigned.

**Type consistency:** `Claim.quote` (Task 4) is read in Task 5's SSE payload and Task 9's `all_claims` filter. `ModelCapabilities` (Task 6) is consumed by `budget_for` (Task 7) and `_bound`/`_call_structured` (Task 8). `fuse_scores` keyword names (`recency`, `citation`) match between Task 10's definition and its two call sites. `has_compare_intent` (Task 11) matches its import in `synthesizer.py`.

**Known ordering constraint:** Task 8 changes `extract_claims`'s signature, which Task 4 also touches. Task 4 must land first; the plan's order enforces this.
