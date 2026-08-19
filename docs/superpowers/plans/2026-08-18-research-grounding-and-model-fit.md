# Research Model Fit — Implementation Plan (Revision 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Revision 2 (2026-08-19):** The baseline probe falsified spec section 1.1. Grounding is **not** inert for Vietnamese queries — measured mean grounded fraction 0.396, mean confidence 0.607, 6 iteration rounds across 8 queries. The grounding repair (revision 1 Tasks 2–5) and iteration steering (revision 1 Task 9) are **removed**; they had no measured defect to fix. Revision 1 is kept at `2026-08-18-research-grounding-and-model-fit.rev1-superseded.md`. What remains is the work the baseline and direct code reading independently confirm.

**Goal:** Retune the synthesis pipeline for `gpt-5.6-luna` instead of Llama3 8B, unify the two rerank paths, and delete code and calls with no production consumer.

**Architecture:** Model limits move into a capability table in `core/llm.py`, from which the synthesizer derives one context budget instead of four constants hardcoded for an 8k-token model. Structured output becomes the primary parse path with the existing JSON-repair ladder demoted to a fallback for Ollama. The comparison-table decision moves to the backend, where the call is actually made.

**Tech Stack:** Python 3.11+, FastAPI, LangChain (`langchain-openai` 1.3.3, `langchain-core` 1.4.9), Pydantic 2.13.4, Weaviate, pytest 8.3.4.

**Spec:** `docs/superpowers/specs/2026-08-18-research-grounding-and-model-fit-design.md` (revision 2 — sections 3 and 7 are withdrawn; do not implement them)

## Global Constraints

- Python interpreter for every command: `.venv/Scripts/python.exe` (Windows, Git Bash shell). Prefix live-run commands with `PYTHONPATH=. PYTHONIOENCODING=utf-8` — without the latter, Vietnamese output crashes the cp1252 console encoder.
- Test root is `tests/` (`pyproject.toml` sets `testpaths = ["tests"]`). Backend code lives under `backend/app/`.
- `tests/test_news_fetcher.py` has **4 pre-existing failures** unrelated to this work. A run showing exactly those 4 failures and nothing else is green. Baseline: **449 passed, 4 failed, 17 skipped**.
- `grounding.py`, `sufficiency.py`, `iteration.py`, `chunking.py` and the scoring functions in `ranking.py`/`reranker.py` are **pure — no I/O, no network, no imports of embeddings or LLM clients**. Preserve this. Anything needing I/O is injected as a callable, matching how `extract_claims` already takes `llm_call`.
- Every LLM step must degrade non-fatally. A provider outage, a schema violation, or a malformed response must never fail a research run.
- **Do not change grounding semantics.** `Claim` gains no fields, `ClaimAuditor` keeps its current verification, `is_grounded`/`lexical_support` keep their thresholds, and `grounding.tokenize` keeps its `[a-z0-9]+` pattern. Revision 2 removed that work; a task that touches it is out of scope.
- Ollama/llama3 remains supported. Nothing may assume structured output or a large context window is available.
- Context budget formula, exact: `effective_tokens = min(context_window * 0.5, 60_000)`; `max_chars = effective_tokens * 3.5`; `per_source_chars = max_chars // 15`.
- Commit after every task. Never use `--no-verify`. Branch is `develop` — do not branch, merge, or push.

---

## File Structure

**Created:**
- `backend/app/features/research/output_schemas.py` — Pydantic schemas for LLM structured output. Separate from `schemas.py`, which is HTTP request/response only.
- `tests/test_model_capabilities.py` — capability table, resolution, budget derivation.
- `tests/test_structured_output.py` — structured path and its fallback.
- `tests/test_compare_intent.py` — comparison-intent detection.

**Modified:**
- `backend/app/core/llm.py` — `ModelCapabilities`, `MODEL_CAPABILITIES`, `_resolve_model`, `capabilities_for`.
- `backend/app/features/research/synthesizer.py` — `ContextBudget`, structured output, reasoning effort, comparison gating, removals.
- `backend/app/features/research/grounding.py` — `extract_claims` gains an injected `structured_call`. **No semantic change.**
- `backend/app/features/research/agent.py` — pass capabilities to `Synthesizer`; removals.
- `backend/app/features/research/search/query.py` — `_COMPARE_KEYWORDS`, `has_compare_intent`.
- `backend/app/features/research/search/ranking.py` — use `cross_encoder_scores` and shared `fuse_scores`; `recency_score` accepts `published_at`.
- `backend/app/features/research/reranker.py` — `fuse_scores` gains recency/citation.
- `backend/app/features/research/router.py`, `service.py`, `prompts.py`, `search/community.py` — removals.
- `frontend/src/components/research/ResearchResult.tsx` — drop `hasCompareIntent`.

**Already done (revision 1, commit `df543e1`):** `tools/research_probe.py` and the baseline at `docs/superpowers/plans/assets/2026-08-18-baseline.json`.

---

### Task 1: Model capability table

**Files:**
- Modify: `backend/app/core/llm.py`
- Test: `tests/test_model_capabilities.py` (create)

**Interfaces:**
- Produces:
  - `ModelCapabilities(context_window: int, supports_structured_output: bool, supports_temperature: bool, reasoning_effort_levels: tuple[str, ...] = ())` — frozen dataclass.
  - `DEFAULT_CAPABILITIES`, `MODEL_CAPABILITIES: dict[str, ModelCapabilities]`
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

- [ ] **Step 3: Implement the table**

In `backend/app/core/llm.py`, add `from dataclasses import dataclass` to the imports, then add after `MODEL_REGISTRY`:

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

Replace `get_llm` so the per-provider defaults live in exactly one place:

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

The unknown-provider check moved **before** model resolution so `get_llm(provider="nope")` still raises `ValueError`, as the existing `tests/test_llm.py` expects.

- [ ] **Step 5: Run tests**

Run: `.venv/Scripts/python.exe -m pytest tests/test_model_capabilities.py tests/test_llm.py tests/test_api_models.py -v`

Expected: PASS, all.

- [ ] **Step 6: Commit**

```bash
git add backend/app/core/llm.py tests/test_model_capabilities.py
git commit -m "feat(llm): add model capability table and single model resolution path"
```

---

### Task 2: Context budget from capabilities

**Files:**
- Modify: `backend/app/features/research/synthesizer.py`, `agent.py`
- Test: `tests/test_model_capabilities.py` (extend)

**Interfaces:**
- Consumes: `ModelCapabilities`, `capabilities_for` (Task 1).
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

In `backend/app/features/research/synthesizer.py`, add `from dataclasses import dataclass` to the imports and **delete** these four constants:

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
```

- [ ] **Step 4: Use the budget in `Synthesizer`**

Replace `Synthesizer.__init__`:

```python
    def __init__(self, llm=None, capabilities=None):
        from backend.app.core.llm import capabilities_for
        self.llm    = llm or get_llm()
        self.caps   = capabilities or capabilities_for()
        self.budget = budget_for(self.caps)
```

Replace `_ctx` so both limits default to the budget:

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

In `_run_sections`, build the context once and reuse it — four calls built it four times over the same sources:

```python
        ctx = self._ctx(ranked)
        steps = [
            ("summaries",    self._make_summaries,           (query, ctx, out)),
            ("key_points",   self._make_key_points,          (query, ctx, out)),
            ("comparison",   self._make_comparison_table,    (query, ranked, out)),
            ("chart",        self._make_chart_data,          (query, ctx, out)),
            ("follow_ups",   self._make_follow_up_questions, (query, out)),
            ("papers",       self._make_papers_and_refs,     (ranked, out)),
        ]
```

In `synthesize_rag`, replace `self._ctx(sources, max_chars=6500, per_source=1300)` with `self._ctx(sources)`.

In `_make_comparison_table`, remove the 4-source and 200-char caps:

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

Expected: `449 passed, 4 failed` or better. If `tests/test_synthesize_grounded.py` references the deleted constants, update it to use `budget_for`.

- [ ] **Step 7: Commit**

```bash
git add backend/app/features/research/synthesizer.py backend/app/features/research/agent.py tests/test_model_capabilities.py
git commit -m "feat(research): derive context budget from model capabilities"
```

---

### Task 3: Structured output with reasoning effort

**Files:**
- Create: `backend/app/features/research/output_schemas.py`
- Modify: `backend/app/features/research/synthesizer.py`, `grounding.py`
- Test: `tests/test_structured_output.py` (create)

**Interfaces:**
- Consumes: `self.caps`, `self.budget` (Task 2).
- Produces: `Synthesizer._bound(effort)`, `Synthesizer._call(prompt, effort=None) -> str`, `Synthesizer._call_structured(prompt, schema, effort=None) -> BaseModel | None`; `grounding.extract_claims(query, sources, llm_call, parse_array, structured_call=None)`.

Verified on the installed stack (`langchain-openai` 1.3.3): `llm.bind(reasoning_effort="low").with_structured_output(Schema).invoke(prompt)` returns a validated model instance from `gpt-5.6-luna`.

**Scope note:** this task changes *how output is parsed*, never what grounding decides. `ExtractedClaim` mirrors exactly the fields `extract_claims` already reads today — `text`, `source_id`, `evidence_type`. Do not add a `quote` field; that belongs to withdrawn spec section 3.

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
    """Mirrors exactly what extract_claims already reads from the text path."""
    text:          str
    source_id:     int
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
        text = self._text

        class _R:
            content = text
        return _R()


def _synth(llm, caps):
    return Synthesizer(llm=llm, capabilities=caps)


_STRUCTURED_CAPS = ModelCapabilities(200_000, True, True, ("low", "medium", "high"))
_PLAIN_CAPS      = ModelCapabilities(8192, False, True)


def test_structured_path_returns_parsed_model():
    want = SummaryShortMedium(short="s", medium="m")
    s = _synth(_FakeLLM(structured_result=want), _STRUCTURED_CAPS)
    assert s._call_structured("p", SummaryShortMedium).short == "s"


def test_structured_path_skipped_when_capability_absent():
    s = _synth(_FakeLLM(structured_result=SummaryShortMedium(short="s", medium="m")), _PLAIN_CAPS)
    assert s._call_structured("p", SummaryShortMedium) is None


def test_structured_failure_returns_none_so_caller_falls_back():
    s = _synth(_FakeLLM(structured_result=ValueError("schema violation")), _STRUCTURED_CAPS)
    assert s._call_structured("p", SummaryShortMedium) is None


def test_effort_is_bound_when_model_supports_it():
    llm = _FakeLLM(structured_result=SummaryShortMedium(short="s", medium="m"))
    _synth(llm, _STRUCTURED_CAPS)._call_structured("p", SummaryShortMedium, effort="high")
    assert {"reasoning_effort": "high"} in llm.bind_calls


def test_effort_not_bound_when_model_lacks_the_knob():
    llm = _FakeLLM()
    _synth(llm, _PLAIN_CAPS)._call("p", effort="high")
    assert llm.bind_calls == []


def test_unsupported_effort_level_is_not_bound():
    llm = _FakeLLM()
    _synth(llm, _STRUCTURED_CAPS)._call("p", effort="xhigh")   # not in this model's tuple
    assert llm.bind_calls == []


def test_call_returns_text_and_survives_provider_error():
    class _Raiser(_FakeLLM):
        def invoke(self, prompt):
            raise RuntimeError("provider down")

    assert _synth(_FakeLLM(), _PLAIN_CAPS)._call("p") == "SUMMARY: s\nOVERVIEW: m"
    assert _synth(_Raiser(), _PLAIN_CAPS)._call("p") == ""
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_structured_output.py -v`

Expected: FAIL — `AttributeError: 'Synthesizer' object has no attribute '_call_structured'`.

- [ ] **Step 4: Implement the call layer**

In `backend/app/features/research/synthesizer.py`, add above the `Synthesizer` class:

```python
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
```

Replace `_call` and add the two new methods:

```python
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
```

Add `from backend.app.features.research import output_schemas` to the imports.

- [ ] **Step 5: Migrate each section**

Each maker tries structured first and keeps its existing body as the fallback. Read the current file and preserve the existing parsing code exactly where the snippets below say "unchanged".

`_make_summaries`:

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

`_make_key_points` — insert before the existing body:

```python
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

`_make_comparison_table` — after `src_text` is built:

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
        valid = [
            r for r in self._parse_array(raw)
            if isinstance(r, dict) and "source" in r and "main_claim" in r
        ]
        out.comparison_table = valid
        logger.info("Comparison: %d rows", len(out.comparison_table))
```

The metadata-fabricated fallback is deleted here — Task 5 explains why.

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

`_make_follow_up_questions` — signature stays `(self, query, out)`:

```python
        parsed = self._call_structured(
            prompts.follow_up_questions_prompt(query), output_schemas.FollowUps, "low",
        )
        if parsed is not None:
            out.follow_up_questions = [q.strip() for q in parsed.questions if "?" in q][:4]
            logger.info("Follow-up questions: %d (structured)", len(out.follow_up_questions))
            return
        raw = self._call(prompts.follow_up_questions_prompt(query), "low")
        # ... existing parsing, unchanged ...
```

- [ ] **Step 6: Route claim extraction through the structured path**

In `grounding.py`, change only how the raw list is obtained. **Do not change the validation loop or any threshold.**

```python
def extract_claims(query, sources, llm_call, parse_array, structured_call=None) -> list[Claim]:
    """`structured_call` is an injected callable returning an object with a
    `.claims` list carrying text/source_id/evidence_type, or None to use the
    text path. Injected, not imported, so this module stays pure."""
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

In `synthesizer._attach_grounding`, pass the two callables. `ClaimAuditor()` is constructed exactly as today:

```python
            claims = extract_claims(
                query, sources,
                lambda p: self._call(p, "high"),
                self._parse_array,
                structured_call=lambda p: self._call_structured(
                    p, output_schemas.Claims, "high",
                ),
            )
            claims = ClaimAuditor().verify(claims, sources)
```

- [ ] **Step 7: Run tests, then a live check**

Run: `.venv/Scripts/python.exe -m pytest tests -q`

Expected: `449 passed, 4 failed` or better.

Then confirm the structured path actually engages against the real model:

```bash
PYTHONPATH=. PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe -c "
from backend.app.features.research.synthesizer import Synthesizer
from backend.app.features.research.models import SearchResult
s = Synthesizer()
print('structured:', s.caps.supports_structured_output, '| budget:', s.budget)
src = [SearchResult(source='web', title='Diffusion', url='http://x',
       content='Diffusion models are increasingly replacing GANs for image synthesis due to better mode coverage.')]
out = s.synthesize_grounded('mo hinh khuech tan la gi', src)
print('claims:', len(out.claims), 'confidence:', out.confidence)
print('short:', out.summary_short[:90])
"
```

Expected: `structured: True`, `ContextBudget(max_chars=210000, per_source_chars=14000)`, a non-empty summary, and grounding behaving as before this task.

- [ ] **Step 8: Commit**

```bash
git add backend/app/features/research/output_schemas.py backend/app/features/research/synthesizer.py backend/app/features/research/grounding.py tests/test_structured_output.py
git commit -m "feat(research): structured output with per-call-site reasoning effort"
```

---

### Task 4: Unify the two rerank paths

**Files:**
- Modify: `backend/app/features/research/reranker.py`, `search/ranking.py`
- Test: `tests/test_reranker.py`, `tests/test_ranking_signals.py` (extend)

**Interfaces:**
- Produces: `fuse_scores(rerank, base, cred, recency=None, citation=None) -> list[float]`; `recency_score(extra, ref_year=None)` additionally reading `extra["published_at"]`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_reranker.py`:

```python
def test_fuse_scores_three_signal_weights():
    assert rr.fuse_scores(rerank=[1.0], base=[1.0], cred=[1.0]) == [1.0]
    assert abs(rr.fuse_scores(rerank=[1.0], base=[0.0], cred=[0.0])[0] - 0.7) < 1e-9


def test_fuse_scores_five_signal_weights():
    out = rr.fuse_scores(rerank=[1.0], base=[1.0], cred=[1.0], recency=[1.0], citation=[1.0])
    assert abs(out[0] - 1.0) < 1e-9
    out = rr.fuse_scores(rerank=[1.0], base=[0.0], cred=[0.0], recency=[0.0], citation=[0.0])
    assert abs(out[0] - 0.55) < 1e-9


def test_fuse_scores_five_signal_without_reranker():
    out = rr.fuse_scores(rerank=None, base=[1.0], cred=[1.0], recency=[1.0], citation=[1.0])
    assert abs(out[0] - 1.0) < 1e-9


def test_fuse_scores_monotonic_in_rerank():
    assert rr.fuse_scores([0.9], [0.5], [0.5])[0] > rr.fuse_scores([0.1], [0.5], [0.5])[0]
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
# Weight sets, previously duplicated with different numbers in
# search/ranking.py. Neither call site's effective scoring changes — only
# where the reranker score comes from (ranking.py now uses the Cohere → BGE
# ladder instead of BGE alone).
_W_5           = {"rerank": 0.55, "cred": 0.20, "recency": 0.10, "citation": 0.10, "base": 0.05}
_W_5_NO_RERANK = {"base": 0.40, "cred": 0.35, "citation": 0.15, "recency": 0.10}
_W_3           = {"rerank": 0.70, "cred": 0.20, "base": 0.10}
_W_3_NO_RERANK = {"base": 0.70, "cred": 0.30}


def fuse_scores(
    rerank:   list[float] | None,
    base:     list[float],
    cred:     list[float],
    recency:  list[float] | None = None,
    citation: list[float] | None = None,
) -> list[float]:
    """Blend relevance signals into one score per document.

    Five-signal blend when recency/citation are supplied (live search results
    carry publication dates and citation counts), three-signal otherwise
    (stored chunks do not).
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
    only the first two meant every stored source scored 0.0 no matter how
    recent it was.
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

Replace `rerank_results` in the same file:

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

    final  = fuse_scores(rerank, base, cred, recency=recency, citation=citation)
    ranked = sorted(zip(results, final), key=lambda x: x[1], reverse=True)
    top    = [r for r, _ in ranked[:top_k]]
    logger.info(
        "Reranked %d → top %d results (%s)",
        len(results), len(top),
        "cross-encoder" if rerank is not None else "credibility fallback",
    )
    return top
```

Change the import at the top of `ranking.py` to:

```python
from backend.app.features.research.reranker import (
    _CREDIBILITY, cross_encoder_scores, fuse_scores,
)
```

and delete the now-unused `_get_reranker` helper.

- [ ] **Step 6: Run tests**

Run: `.venv/Scripts/python.exe -m pytest tests -q`

Expected: `449 passed, 4 failed` or better. A test asserting the old `rerank_results` internals should assert ordering behavior instead of weights.

- [ ] **Step 7: Commit**

```bash
git add backend/app/features/research/reranker.py backend/app/features/research/search/ranking.py tests/test_reranker.py tests/test_ranking_signals.py
git commit -m "refactor(research): one rerank ladder and one fusion function"
```

---

### Task 5: Remove dead code and move comparison gating to the backend

Measured on the baseline: the comparison table was populated with 4 rows on **all 8** queries, while only 2 of those queries had comparison intent. Six of eight comparison calls were made and discarded.

**Files:**
- Modify: `synthesizer.py`, `agent.py`, `router.py`, `service.py`, `prompts.py`, `search/community.py`, `search/query.py`, `search/__init__.py`
- Modify: `frontend/src/components/research/ResearchResult.tsx`
- Modify: `tests/test_security_framing.py`, `tests/test_research_wiring.py`, `tests/contract/test_api_contracts.py`
- Test: `tests/test_compare_intent.py` (create)

**Interfaces:**
- Produces: `has_compare_intent(query: str) -> bool` in `search/query.py`, exported through `search/__init__.py`.

- [ ] **Step 1: Write the failing test**

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
# meant the backend made the comparison LLM call on every run and the UI threw
# the result away unless the query happened to contain one of these. Measured
# on 8 baseline queries: 8 calls made, 2 displayable. The decision belongs where
# the call is made.
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

In `_run_sections`, drop the unconditional comparison step and add it only when the query asks for one:

```python
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
```

Import at the top: `from backend.app.features.research.search.query import has_compare_intent`.

Also delete the metadata-fabricated `comparison_table` block in `synthesize_rag` — the same `"See full source for details"` filler the frontend already discards — leaving `out.comparison_table` empty there.

- [ ] **Step 5: Drop the frontend gate**

In `frontend/src/components/research/ResearchResult.tsx`, delete `COMPARE_KEYWORDS`, `queryLower` and `hasCompareIntent`, and replace the two lines that used them:

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
| `router.py` | `serve_paper` with its `@router.get("/api/paper/{filename}")`, `clear_research_cache` with its `@router.delete("/api/research/cache")`, and the then-unused `os` import |
| `service.py` | `ResearchService.clear_cache` |
| `synthesizer.py` | the `pdf_filename` sha256 block in `_make_papers_and_refs` — keep `pdf_url`, which the UI links directly |
| `search/community.py` | `HuggingFaceSearcher._search_models` and `_MODELS_URL`; `search()` becomes `return self._search_papers(query, k)` |

Keep `_QueryCache` and the module-level `_cache` — `_top_up` reads it.

- [ ] **Step 7: Update the tests that exercised removed code**

- `tests/test_security_framing.py`: delete `test_answer_frames_context`. Coverage is preserved by `test_deep_dive_context_frames_client_content` in the same file, which exercises the live deep-dive path.
- `tests/test_research_wiring.py`: delete the two tests calling `agent.run(...)` (near lines 295 and 374). `run_streaming` coverage in the same file is unaffected.
- `tests/contract/test_api_contracts.py`: remove any assertion referencing `/api/paper/` or `DELETE /api/research/cache`.

- [ ] **Step 8: Run the suite and the frontend build**

Run: `.venv/Scripts/python.exe -m pytest tests -q`

Expected: 4 failures, all in `tests/test_news_fetcher.py`. The passing total drops below 449 because tests for removed code were deleted — expected and correct.

Run: `cd frontend && npm run build`

Expected: build succeeds with no unused-variable errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(research): remove uncalled code, gate comparison call in backend"
```

---

### Task 6: Re-measure and compare

**Files:**
- Create: `docs/superpowers/plans/assets/2026-08-18-after.json`

- [ ] **Step 1: Re-run the probe**

```bash
PYTHONPATH=. PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe tools/research_probe.py --out docs/superpowers/plans/assets/2026-08-18-after.json
```

Run this from a shell that stays alive for the full ~10 minutes; the run makes 8 live research calls.

- [ ] **Step 2: Compare against the baseline**

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

| Metric | Baseline | Expected after | Why |
|---|---|---|---|
| `mean_ctx_chars` | 7,203 | far larger | the budget no longer caps at a Llama3-era constant |
| `comparison_rows` | 4 on all 8 queries | populated on 2 of 8 | the call is gated on intent; "So sánh DPO và PPO" and "…khác GAN ở điểm nào" are the two queries that ask for a comparison |
| `mean_grounded_fraction` | 0.396 | **unchanged** | grounding semantics were deliberately untouched |
| `mean_confidence` | 0.607 | **unchanged** | same |
| `total_iteration_rounds` | 6 | roughly unchanged | same |
| `mean_wall_seconds` | 75.2 | may rise | more context, `high` effort on two calls |

**A material move in `mean_grounded_fraction` or `mean_confidence` is a regression signal, not a win.** This plan does not change grounding; if those numbers shift, something changed that should not have. Investigate before proceeding.

Compare per-row `comparison_rows` directly — six of eight queries dropping to zero is this plan's clearest measurable outcome.

- [ ] **Step 3: Reproduce the baseline's conditions or say so**

The baseline ran while Weaviate returned 503 and Semantic Scholar failed on every query, so it measured the live-search path only. If those services are reachable this time, the runs are not comparable — record that rather than reporting a difference as if this work caused it.

- [ ] **Step 4: Record the results**

Append a `## 13. Results` section to the spec with the before/after table and the environment note.

- [ ] **Step 5: Commit**

```bash
git add -f docs/superpowers/plans/assets/2026-08-18-after.json docs/superpowers/specs/2026-08-18-research-grounding-and-model-fit-design.md
git commit -m "chore(research): record post-change probe results"
```

---

## Self-Review

**Spec coverage (revision 2 scope only):**

| Spec section | Task |
|---|---|
| §4.1 capability table | 1 |
| §4.2 context budget | 2 |
| §4.3 reasoning effort per call site | 3 |
| §5 structured output + fallback ladder | 3 |
| §6 rerank unification + `recency_score` epoch fix | 4 |
| §8 removals + comparison gating | 5 |
| §9 probe and comparison | 6 (baseline already done, commit `df543e1`) |
| §3, §7 | **withdrawn — no task, by design** |

**Cross-task consistency after pruning revision 1:** three couplings to the removed grounding work were cut deliberately — `ExtractedClaim` carries no `quote` field, `_attach_grounding` constructs a plain `ClaimAuditor()`, and `follow_up_questions_prompt` keeps its single-argument signature. `ModelCapabilities` (Task 1) is consumed by `budget_for` (Task 2) and `_bound`/`_call_structured` (Task 3). `fuse_scores` keyword names match between Task 4's definition and both call sites. `has_compare_intent` (Task 5) matches its import in `synthesizer.py`.
