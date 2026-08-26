# Capability Observability: Making Silent Degradation Loud

**Date:** 2026-08-25

**Status:** Approved design; awaiting written-spec review

**Scope:** Record the real outcome of every call to the four capabilities the research pipeline silently depends on — LLM provider, embeddings, knowledge store, cross-encoder reranker — and expose that record to an operator. Observation only.

Does not change: user-facing behavior, the SSE event contract, the UI, or the control flow at any reporting site.

## 1. Problem

### 1.1 The health endpoint cannot report ill health

```python
@app.get("/health")
async def health():
    return {"status": "ok", "version": "3.0.0"}
```

It returns `ok` when Weaviate is returning 503, when the reranker cannot score, when embeddings are rate-limited, and when the LLM provider is unreachable. The application has exactly one place to answer "am I working", and that place is hardcoded.

### 1.2 Thirty-two ways to fail quietly

The research feature contains 32 non-fatal degradation points — `try/except` blocks that log a warning and continue. Individually each is correct: a research run must not die because one source timed out. Collectively they mean **every failure mode looks identical to normal operation from outside the process**.

Three failures found during the 2026-08-18/25 work share exactly this shape:

| Failure | How long it lasted | What the outside saw |
|---|---|---|
| BGE reranker could not score (`XLMRobertaTokenizer has no attribute prepare_for_model`) | unknown — the model *loaded*, so startup looked healthy | answers ranked by credibility only |
| Weaviate Cloud returning 503 | days | every query searched live, knowledge store never used |
| `tests/test_news_fetcher.py` fixtures aged past `NEWS_MAX_ITEM_AGE_DAYS` | a fortnight | four red tests blamed on unrelated code |

The reranker case is the sharpest. `_bge_reranker()` returned a usable object, so every signal that existed said the capability was present. Only `compute_score` raised, and its caller swallowed the exception into "fall back to credibility". The main ranking signal of the research feature was dead, and nothing in the system was capable of saying so.

### 1.3 Why synthetic probing is the wrong instrument

All three failures were only visible when real data went through. A probe embedding of the string `"healthcheck"` can succeed while a real batch of 32 chunks fails on a rate limit; a reranker can load and still be unable to score a real pair.

This matters beyond convenience. Twice during the preceding work a synthetic measurement produced a confident and wrong conclusion — a hand-authored claim/source pair used as evidence about production, and a `grounded_fraction` computed by the very component under suspicion. A health system built on synthetic probes repeats that error by construction.

## 2. Requirements

Confirmed with the user during design:

1. **Operator only.** The user-facing product does not change: no SSE field, no UI warning, no error surfaced to the reader.
2. **Four capabilities.** LLM provider, embeddings, knowledge store, cross-encoder reranker. Search sources are deliberately excluded — they are flaky by nature and mutually redundant, so reporting them produces noise that teaches operators to ignore the signal.
3. **Observation must never change control flow.** Adding observability must not introduce the class of bug it exists to catch.
4. **Report real outcomes, not probe outcomes.** A single boot probe seeds the state; everything after that comes from production traffic.

## 3. The Registry

`backend/app/core/capabilities.py` — placed in `core`, not in `features/research`, because the LLM and embeddings are shared infrastructure and research is merely the first consumer.

### 3.1 State

Four capabilities: `llm`, `embeddings`, `knowledge_store`, `reranker`.

Four statuses: `ok`, `degraded`, `disabled`, `unknown`.

| Field | Meaning |
|---|---|
| `status` | from the **most recent observation** |
| `consecutive_failures` | current unbroken failure run; reset by any success |
| `total_ok`, `total_failed` | cumulative counters, never reset |
| `last_error`, `last_error_at` | most recent error message (truncated to 200 chars) and its timestamp |
| `last_ok_at` | timestamp of the last successful use |

**Why both a status and two counters.** Status alone flaps: one transient rate-limit flips `degraded` then back to `ok`, and what an operator sees depends on when they look. The counters separate two situations that need different responses:

- **Dead capability:** `total_ok = 0`, `consecutive_failures` climbing without bound.
- **Flaky dependency:** both counters rising, `consecutive_failures` repeatedly reset.

Had this table existed, the reranker outage would have been unmissable on first inspection: `total_ok = 0` after hundreds of requests admits no innocent explanation.

**Why `disabled` is separate from `degraded`.** `RERANK_ENABLED=False` is a deliberate choice. Reporting a switched-off capability as degraded is worse than silence — it trains operators to dismiss warnings.

### 3.2 API

Call sites must be short enough that nobody is tempted to skip them:

```python
capabilities.ok(RERANKER)
capabilities.failed(RERANKER, "XLMRobertaTokenizer has no attribute prepare_for_model")
capabilities.disabled(RERANKER)
capabilities.snapshot()   # -> {"status": ..., "capabilities": {...}}
```

`snapshot()` computes the aggregate `status` itself, so both endpoints read the same rule from one place rather than each deriving it.

### 3.3 Purity and concurrency

Every reporting site sits in a module that already performs I/O: `reranker.py`, `knowledge_store.py`, `embeddings.py`, `synthesizer._call`. **No pure module reports** — `grounding.py`, `sufficiency.py`, `iteration.py`, `chunking.py` and the scoring functions in `ranking.py`/`reranker.py` are untouched. The existing purity constraint holds without needing a new injection point.

The pipeline is multithreaded throughout (search, synthesis, and the judge each use a `ThreadPoolExecutor`), so the registry guards its state with a `threading.Lock`. Operations are a few field updates; this is not a contention point.

**Stated limitation:** state lives in process memory. Multiple workers each hold their own picture, and a restart clears it. Acceptable for the current single-process deployment, but it is an assumption that should be written down rather than left implicit.

## 4. Reporting Sites

**The rule: report at the capability boundary — the function that actually talks to the dependency — and never change control flow.** What raises today still raises; what swallows today still swallows.

| Capability | Site | Current behavior, preserved |
|---|---|---|
| `embeddings` | `embed_texts`, `embed_query` | raise to caller — wrap, report, **re-raise** |
| `llm` | `invoke_chat`, `Synthesizer._call` | `_call` already swallows and returns `""` — report immediately before returning |
| `knowledge_store` | `_get_weaviate`, and the existing handlers in `retrieve_candidates` / `retrieve` / `add_results` | already caught and logged |
| `reranker` | `cross_encoder_scores` | scores → `ok`; `None` → `degraded` |

Existing `logger.warning` calls are **kept**. The registry supplements logging rather than replacing it; the log remains the only place carrying the full context of a failure.

### 4.1 Three deliberate non-reports

**`_call_structured` does not report.** It fails mainly on schema violations, not provider outages, and it already falls back to `_call`, which reports if the provider is genuinely down. Reporting here would make a stubborn model look like a dead provider.

**`cross_encoder_scores` with empty input does not report.** It returns `None` when `not docs`. That is not a failure, and reporting it would inflate `total_failed` with calls that had nothing to do.

**A configured-off capability reports `disabled`, not `degraded`.** For the reranker this is reported from `knowledge_store._rerank`, the only site that reads `RERANK_ENABLED`.

**Pre-existing inconsistency, recorded not fixed:** `RERANK_ENABLED` is honoured by `knowledge_store._rerank` and ignored by `search/ranking.py:rerank_results`, which calls `cross_encoder_scores` unconditionally. Setting the flag false today disables reranking for stored chunks but not for live search results. This predates the present work — the previous `rerank_results` reached `_bge_reranker()` directly, also without checking the flag. It is noted here because it makes `disabled` an incomplete description of the system's actual state, and whoever fixes the flag should revisit this reporting site.

## 5. Boot Seeding

Before the first request every capability is `unknown` — true, but not useful. One probe pass at startup fills that gap, running in the existing background thread in `lifespan` so it cannot delay boot or crash the app.

| Capability | Probe | Cost |
|---|---|---|
| `reranker` | `reranker_selfcheck()` — already exists | free |
| `knowledge_store` | `get_store().size()` — a real count query | free |
| `embeddings` | `embed_query("healthcheck")` | ~$0.0000002 |
| `llm` | **not probed** | — |

**Why the LLM is not probed.** It is the only one of the four whose probe costs a real billed completion on every start. Under `--reload` in development that is every file save. What the cost buys is small: the first research request arrives seconds later and reports the provider's true state under real load.

The most common configuration failure — a missing API key — already raises loudly from `get_llm`, so it is not in the silent-degradation class this work addresses.

`llm` therefore starts `unknown` and corrects itself on first use. A deliberate trade, not an omission.

## 6. Endpoints

`/health` does **not** start returning 503 when a capability is degraded. Liveness and capability health are different questions: returning 503 because the reranker is flaky would let a load balancer kill a process that is serving correctly. That trades a silent failure mode for a loud but wrong one.

**`GET /health`** — small and fast, always 200, with one honest field added:

```json
{ "status": "degraded", "version": "3.0.0" }
```

`status` is `degraded` when **any** capability is `degraded`. `disabled` and `unknown` do not degrade it: switched off on purpose is not broken, and not yet exercised is not known.

**`GET /health/capabilities`** — the full table. All four capabilities are always present, including those that are `ok` or `unknown`; an absent key would be indistinguishable from a capability nobody thought to register. Abbreviated to one entry here:

```json
{
  "status": "degraded",
  "capabilities": {
    "reranker": {
      "status": "degraded",
      "consecutive_failures": 147,
      "total_ok": 0,
      "total_failed": 147,
      "last_error": "XLMRobertaTokenizer has no attribute prepare_for_model",
      "last_error_at": 1756108800.0,
      "last_ok_at": null
    }
  }
}
```

That `total_ok: 0` beside `total_failed: 147` is the line that would have ended the reranker outage in minutes.

## 7. Testing

The most important group is not the registry's own tests but **behavior preservation**. The chief risk of this design is adding observation and accidentally altering flow — precisely the class of bug it exists to catch.

| Target | Cases |
|---|---|
| Registry | `ok`/`failed` transitions; `consecutive_failures` resets on success; cumulative counters; `disabled` not overwritten by a `degraded` report; snapshot shape |
| **Behavior preservation** | `embed_texts` failure re-raises the *same* exception; `_call` failure still returns `""`; `cross_encoder_scores` still returns `None`; no handler swallows anything new |
| No false reports | `cross_encoder_scores([])` does not increment `total_failed`; `RERANK_ENABLED=False` yields `disabled` |
| Endpoints | `/health` always 200; `status` degrades on any degraded capability; `unknown` and `disabled` do not degrade it; `/health/capabilities` returns every field |
| Concurrency | concurrent reports from multiple threads lose no counter increments |
| Regression | the existing 529 tests stay green — any test that needs changing is evidence that behavior changed |

## 8. Out of Scope

- **Alerting.** No webhook, email, or push. This makes the truth available; it does not deliver it.
- **User-facing changes.** No SSE field, no UI, no error shown to the reader.
- **Self-healing.** No retry, no reconnect, no circuit breaker. Observation only.
- **Search sources.** Tavily, arXiv, Semantic Scholar, HuggingFace, Stack Overflow, DuckDuckGo — flaky by nature, mutually redundant, and reporting them produces alarm fatigue.
- **Other features.** News, PDF, coding and the session store keep their current behavior.

## 9. The Limitation Worth Stating Plainly

Of the three failures described in section 1.2, this design catches **two**: the dead reranker and the Weaviate outage. Both are *failures* — an exception is raised, a degradation path is taken.

It would **not** have caught the grounding defect. Grounding never failed. It ran cleanly, raised nothing, and reported a healthy-looking `grounded_fraction` of 0.396 while falsely rejecting 100% of valid claims. The registry would have recorded `total_ok` climbing steadily throughout.

The boundary is: **this design catches a capability that is dead, not a capability that is wrong.** The second class needs something different in kind — an invariant checkable independently of the component's own opinion, the way a quote can be checked against the source text without asking the auditor. That is a separate problem, and this spec should not be read as promising a solution to it.
