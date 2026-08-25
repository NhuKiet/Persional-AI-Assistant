# Research: Grounding Repair and Model Fit

**Date:** 2026-08-18

**Status:** Revision 2 — section 1.1 was FALSIFIED by the baseline measurement it predicted. Sections 3 and 7 are withdrawn. The remaining sections were independently confirmed and are approved for implementation.

**Revision 2 (2026-08-19):** The probe required by section 9 was run before any code change, as section 11 sequences it. It contradicted section 1.1's central claim. Section 1.1 now records what was actually measured and what the original reasoning got wrong; section 9 records the results.

**Scope:** Repair citation grounding, which is inert for Vietnamese queries; retune context budgets and output formats for the current model instead of Llama3 8B; unify the two divergent rerank paths; steer bounded iteration from evidence gaps instead of invented questions; remove code and features with no production caller.

Does not change: the four-state knowledge gate (`sufficiency.assess`), the search source registry, chunking, embeddings, the SSE event contract beyond one added field, or the Weaviate schema.

## 1. Problem

### 1.1 WITHDRAWN — grounding is NOT inert (falsified 2026-08-19)

**This section's claim was wrong. The work it justified is withdrawn.**

The baseline probe (section 9) measured the live pipeline across 8 Vietnamese
queries before any code change:

| Metric | This section predicted | Measured |
|---|---|---|
| mean grounded fraction | ~0.0 | **0.396** |
| mean confidence | ~0.0 | **0.607** |
| iteration rounds | 1 on every query | **6 of 8** (two queries needed none) |

Grounding produced supported claims on all 8 queries; per-query grounded
fraction ranged 0.188 to 0.857. Nothing downstream is starved: claims are
non-empty, confidence is meaningful, and iteration is already skipped when
evidence suffices.

**Why the original reasoning failed.** The measurement below was taken on a
claim/source pair *authored for the purpose* — the example sentence from
`prompts.key_points_prompt`, translated into Vietnamese by hand. Real claims
are not like that. `LANGUAGE_RULE` explicitly instructs the model to "keep
proper nouns, model/paper names, and technical terms without a standard
Vietnamese equivalent in their original form", so genuine claims carry model
names, technical vocabulary and figures in English — exactly the tokens that
match an English source. The evidence was already visible in the table below
and was not read correctly: the "DPO giảm 40%" pair scores 0.111, just under
the 0.12 threshold, *because* it contains DPO, PPO and 40. That was a signal
about where the matching comes from, not a confirmation of failure.

The method error, stated plainly: a synthetic measurement was treated as
evidence about production behavior, when the probe that measures production
behavior directly was available and is cheap.

**Open question this does not settle.** A grounded fraction of 0.396 is not
self-evidently a defect — rejecting unsupported claims is the feature working.
Whether rejected claims are rejected *correctly* or *falsely* requires reading
real claims against real sources, which no metric answers. Until that is done,
there is no established grounding defect to fix.

The original argument is retained below for the record.

### 1.1-original (superseded) Grounding is inert for Vietnamese queries

`grounding.tokenize` matches `[a-z0-9]+` (`grounding.py:19`). `prompts.LANGUAGE_RULE` requires the LLM to write claims in Vietnamese. Sources are predominantly English. The verification step compares the two with Jaccard token overlap against a 0.12 threshold.

Measured on the exact example embedded in `prompts.key_points_prompt`:

| Claim (VI) vs source (EN) | Jaccard, current | Jaccard, unicode `\w+` | Cosine (text-embedding-3-small) |
|---|---|---|---|
| "Mô hình khuếch tán… thay thế GAN…" | 0.053 | 0.033 | 0.290 |
| "DPO giảm 40% thời gian huấn luyện…" | — | 0.111 | 0.619 |
| Unrelated control (Kubernetes source) | — | 0.000 | 0.020 |

Both true pairs fall below the 0.12 threshold **even after fixing the tokenizer to unicode**. The root cause is not diacritics; it is that claims and sources are in different languages, so token overlap cannot be the signal. A regex fix alone does not repair this.

Consequences, on every Vietnamese query:

| Site | Effect |
|---|---|
| `synthesize_grounded` sets `out.claims = [c for c in claims if c.grounded]` | always empty; the UI renders no claims |
| `compute_confidence` | ≈ 0.0; users see an artificially low confidence |
| `derive_limitations` | always reports "N nhận định không tìm được nguồn hỗ trợ" |
| `iteration.needs_iteration` (`len(claims) < 3`) | always True; every run burns an extra top-up search plus a full re-synthesis |
| `filter_by_anchor_relevance` | `anchor_tokens` is empty, so the retrieval-contamination net never fires |
| `community.HuggingFaceSearcher._search_papers` | its `shares_anchor_token` filter never fires (see 1.4) |

`sufficiency.py:36` already hit this problem and fixed it locally with a unicode `\w+` pattern, documenting the reasoning. `grounding.py` was never updated to match.

### 1.2 Context budgets and output handling target Llama3 8B

`synthesizer.py` documents its own constraint: "Llama3 8B có context 8k tokens ~ 6000 ký tự an toàn". From that follow:

- Four graded budgets `_CTX_SUMMARY/_POINTS/_CMP/_CHART` (7000/5000/3500/2500 chars).
- `_ctx(..., per_source=900)` truncates **each source to 900 characters**, after the pipeline spent a crawl, a dedup pass and a rerank producing top-15 sources of up to 8000 characters each.
- `_make_comparison_table` uses only `sources[:4]`, 200 characters each.
- A five-strategy JSON repair ladder in `_parse_obj` (single→double quotes, JS comment stripping, trailing-comma removal, brace closing) that exists because Llama3 emits malformed JSON.
- Regex extraction of `SUMMARY:` / `OVERVIEW:` labels from free prose, with two guessing fallbacks when the model ignores the labels.

The configured model is now `gpt-5.6-luna` (1,050,000-token context, structured output, reasoning-effort control). The graded budgets were never technically motivated in the first place: each section is an independent call with the full context window available to it, so splitting a single budget across them has no basis.

### 1.3 Two divergent rerank paths

| Call site | Score source | Weights |
|---|---|---|
| `search/ranking.py:rerank_results` | `_bge_reranker()` directly — **bypasses the Cohere ladder** | rerank .55 / cred .20 / recency .10 / citation .10 / base .05 |
| `knowledge_store._rerank` | `cross_encoder_scores()` — Cohere → BGE | rerank .70 / cred .20 / base .10 |

`reranker.py` documents itself as the single owner of reranker loading and the credibility table, but `ranking.py` reaches past it.

Related defect: `recency_score` reads `extra["year"]` / `extra["published"]` (`ranking.py:26`), while `_rank_candidates` writes `extra["published_at"]` as an epoch (`knowledge_store.py:150`). The keys never match, so **every source retrieved from the knowledge store scores recency 0.0**, including a paper published this week.

### 1.4 Iteration is steered by an ungrounded question

`prompts.follow_up_questions_prompt(query)` takes only the query — no source context. `iteration.gap_query` then uses `output.follow_up_questions[0]` as the top-up search query.

The supplementary search round is therefore directed by a question the model invented without reading any source. The actual gap lies where the sources are thin, which is information the system already holds: the judge's `missing` field and the set of claims that failed verification.

### 1.5 Work produced and discarded

`ResearchResult.tsx:74` gates the comparison table on the query text:

```ts
const hasCompareIntent = COMPARE_KEYWORDS.some(kw => queryLower.includes(kw));
const showCompare = hasCompareIntent && realCompareRows.length >= 2;
```

For any query without a comparison keyword, the backend still makes the LLM call, parses it, persists it in the session turn and ships it over the wire — and the UI discards it. The decision lives on the wrong side of the boundary.

When that call fails, `_make_comparison_table` fabricates rows from metadata (`strength: f"{s.source} source"`, `limitation: "See full source for details"`). The frontend filters exactly those rows out (`main_claim !== "See source"`). The fallback exists to be discarded.

`HuggingFaceSearcher._search_models` returns, as source content, strings of the form `Downloads: 2,341,109 | Likes: 892 | Tags: pytorch, text-generation`. This enters the synthesis context and is written to the knowledge store as a permanent chunk. It carries no evidentiary value for any research question.

### 1.6 Code with no production caller

| Item | Evidence |
|---|---|
| `Synthesizer.synthesize()` (`synthesizer.py:401`) | no caller; the agent uses `synthesize_grounded` |
| `Synthesizer.answer()` and `prompts.follow_up_answer_prompt` | called only from `tests/test_security_framing.py`; the real deep-dive path uses `astream_chat` (`service.py:186`) |
| `ResearchAgent.knowledge_size()`, `ResearchAgent.clear_knowledge()` | no endpoint, no caller |
| `ResearchAgent.run()` | called only from tests; `ResearchService` uses `run_streaming` |
| `GET /api/paper/{filename}` and the `pdf_filename` sha256 computation | `data/papers/` holds 0 files and no code writes to it; the endpoint can only return 404. The frontend links `pdf_url` directly (`DeepDiveModal.tsx:105`) |
| `DELETE /api/research/cache` | no frontend caller |

## 2. Requirements

Confirmed with the user during design:

1. **Fix what is broken before adding anything.** ~~Grounding, the wasted iteration round,~~ and the divergent rerank paths come first. *(Revision 2: grounding and the iteration round were not broken — see section 1.1.)*
2. **Structured output, not call consolidation.** The seven synthesis calls stay parallel and independently fault-isolated. Only the output format changes.
3. **Exploit the current model without breaking the local one.** Ollama/llama3 remains a supported path, used rarely. Budgets must be derived per model, never hardcoded to one model's limits.
4. **Do not remove safety nets in the same change that alters what they protect.** The `RESEARCH_SUFFICIENCY_ENABLED` kill switch and its legacy `retrieve()` path stay.
5. **Product decisions need evidence.** Whether to keep `chart_data` is deferred until the probe reports how often it produces anything.

## 3. WITHDRAWN — Grounding: Quote-Anchored Verification

**Withdrawn in revision 2.** This section existed to repair the failure
described in section 1.1, which does not exist. Quote-anchored verification
may still be worth building — it detects fabricated figures more directly
than similarity scoring does — but it must be justified by a measured defect,
not by this one. Retained below unimplemented.

### 3.1 Approach

Claims carry a verbatim quote copied from the source they cite. Verification asks whether that quote actually appears in that source — a same-language string comparison — instead of asking whether a Vietnamese claim resembles an English source.

This keeps the verification core pure and deterministic, as `grounding.py`'s docstring already claims it is, and it changes the question from "does this claim look similar to the source?" to "is this sentence actually in the source?", which detects fabricated figures directly.

Two alternatives were considered and rejected:

- **Embedding cosine as the primary signal.** Smallest change, but makes the verification core do I/O, and the margin is uncomfortable — the weakest true pair measured 0.290 against a 0.020 control.
- **Extract claims in English, translate for display.** Keeps the core pure, but adds a translation step and risks claims rendering in English, inconsistent with the rest of the UI.

Embedding cosine is retained as a **batch-level fallback** (3.4).

### 3.2 Data model

`models.Claim` gains `quote: str = ""`.

### 3.3 Extraction

`prompts.claim_extraction_prompt` requests four fields per claim:

```json
{"text": "<Vietnamese, for display>",
 "source_id": <source number>,
 "quote": "<verbatim excerpt from that source, original language, <=200 chars>",
 "evidence_type": "direct|inference|opinion|uncertain"}
```

`LANGUAGE_RULE` applies to `text` only. The prompt states explicitly that `quote` must be copied, not paraphrased.

### 3.4 Verification

Pure, no I/O, in `grounding.py`:

- `normalize(s)`: lowercase, collapse whitespace, normalize curly quotes and dash variants to ASCII equivalents. Models routinely substitute `"` for `"` and `–` for `-` when copying.
- `quote_support(quote, source) -> float`: returns `1.0` when the normalized quote is a substring of the normalized source; otherwise returns the fraction of quote tokens (unicode `\w+`) present in the source.
- Threshold: `0.85`.
- A quote that is empty **or shorter than 20 characters** does not count as a quote. Without this, a model returning `"AI"` matches every source.

`ClaimAuditor.verify` sets `claim.grounded` from `quote_support` against the cited source only.

**Batch-level fallback.** After verifying all claims: if there are at least 3 claims and fewer than 30% are quote-grounded, the quote signal is treated as unusable — the model paraphrased rather than copied — rather than concluding that every claim is fabricated. All claims are then re-verified by cosine similarity between the claim `text` and the content of its cited source, at threshold 0.2, and the fallback is logged.

To preserve `grounding.py`'s purity, `ClaimAuditor` takes an injected `fallback_scorer` callable, matching how `extract_claims` already takes an injected `llm_call`. The synthesizer wires the embedding-backed implementation.

### 3.5 Anchor filter: fixing it without weaponizing it

`grounding.tokenize` moves to unicode `\w+`, matching `sufficiency.py:36`.

This is dangerous on its own. Today `filter_by_anchor_relevance` is harmlessly disabled for Vietnamese queries because `anchor_tokens` returns an empty set. With a unicode tokenizer, a Vietnamese query against English sources produces anchor tokens that match nothing — turning a dead filter into one that **deletes every search result**.

Guard: if the filter would drop more than 80% of results, treat that as evidence of a language mismatch between anchor and corpus rather than evidence that every source is off-topic. Keep all results and log. The existing "no anchor tokens → do not filter" fail-open is retained.

### 3.6 Downstream

`quote` is included in the `claims` entries of the `done` SSE event, letting the UI show the source excerpt beneath each claim. This is the inline-citation capability the product currently lacks, at no additional call cost.

With claims no longer empty, `confidence` becomes meaningful and `needs_iteration` stops returning True unconditionally. The wasted iteration round is fixed by this section; `iteration.py`'s thresholds are not changed.

## 4. Model Capability Table and Context Budget

### 4.1 Table

`MODEL_CAPABILITIES` is added to `core/llm.py` beside `MODEL_REGISTRY` — this is model metadata, not research-specific.

| Field | Purpose |
|---|---|
| `context_window` | real token window |
| `supports_structured_output` | drives section 5 |
| `supports_temperature` | `False` for `gpt-5.6-luna`; measured — langchain_openai silently drops any value other than 1.0 |
| `reasoning_effort_levels` | `None` for ordinary models; `none…max` for `gpt-5.6-luna` |

Unknown models get a conservative default: `context_window=8192`, no structured output, temperature supported.

`capabilities_for(provider, model)` resolves through the same path as `get_llm`, honoring `settings.DEFAULT_MODEL` via `_default_model_for`.

### 4.2 Budget

The four `_CTX_*` constants are removed and replaced by a single `ContextBudget(max_chars, per_source_chars)` used by every section.

```
effective_tokens = min(context_window * 0.5, 60_000)
max_chars        = effective_tokens * 3.5
per_source_chars = max_chars // 15          # 15 = rerank top_k
```

The 3.5 chars/token ratio is a deliberately conservative estimate; Vietnamese consumes more tokens per character than English.

| Model | `max_chars` | `per_source_chars` | Effect |
|---|---|---|---|
| `gpt-5.6-luna` | ~210,000 | ~14,000 | every source enters whole (the crawl cap is 8,000/source) |
| `llama3` (8k) | ~14,000 | ~950 | comparable to today; nothing breaks |

The 60,000-token ceiling is intentional. The pipeline's maximum available material is roughly 15 × 8,000 = 120,000 characters ≈ 30,000 tokens, so the ceiling is never reached with Luna; it exists only to bound pathological inputs. Handing a model 1M tokens because it accepts them is not a goal.

`_make_comparison_table` drops its 4-source / 200-character limits and uses the shared budget.

### 4.3 Reasoning effort per call site

| Call | Effort | Rationale |
|---|---|---|
| `claim_extraction` | `high` | must read carefully and copy verbatim; the foundation of all grounding |
| `summary_detailed` | `high` | the primary deliverable |
| `summary_short_medium`, `key_points`, `comparison` | `medium` | default |
| `chart_data`, `follow_up_questions`, `expand_query` | `low` | mechanical |
| `judge_sufficiency`, `contextualize_query` | `low` | a binary decision / a one-sentence rewrite |

Models without `reasoning_effort_levels` ignore the parameter. Call sites do not branch on model.

## 5. Structured Output

The five-strategy JSON repair ladder is **not deleted**. Ollama remains supported and llama3 has no structured output, so the ladder becomes the fallback path rather than the primary one.

`output_schemas.py` is added — separate from `schemas.py`, which holds HTTP request/response models — containing Pydantic schemas: `SummaryShortMedium`, `KeyPoints`, `ComparisonTable`, `ChartData`, `FollowUps`, `Claims`.

`Synthesizer._call_structured(prompt, schema, effort)`:

- capability true → `llm.with_structured_output(schema)`, returning a validated object.
- capability false, **or** the structured call raises → fall back to `_call` plus the existing `_parse_obj` / `_parse_array`. Log the fallback.

`summary_detailed` keeps its plain-text call. It is 4–6 paragraphs of prose; a schema adds friction and no benefit.

`chart_data` replaces the `"NO_DATA"` sentinel with a `has_data: bool` field, removing the `"NO_DATA" not in raw.upper()` string test.

The largest gain is not JSON but prose parsing: `_make_summaries`'s regex extraction of `SUMMARY:` / `OVERVIEW:` and its two guessing fallbacks disappear from the primary path.

Fault isolation is unchanged — seven parallel futures, each with its own `try`/`except`.

Manual validation in `extract_claims` (`source_id` in range, `evidence_type` in enum) is retained. The schema enforces this on the primary path, but the fallback path still needs it, and defense in depth is warranted at the foundation of grounding.

**Explicitly out of scope:** the schema forces `values` to be numeric, which prevents a chart of strings, but does **not** verify that those numbers appear in any source. Fabricated chart figures remain possible after this work.

## 6. Rerank Unification

`fuse_scores` in `reranker.py` gains optional parameters:

```python
fuse_scores(rerank, base, cred, recency=None, citation=None) -> list[float]
```

Both weight sets are the ones already in use, now stated in one place:

| Blend | Weights |
|---|---|
| five-signal (recency/citation supplied) | rerank .55 / cred .20 / recency .10 / citation .10 / base .05 |
| five-signal, no reranker available | base .40 / cred .35 / citation .15 / recency .10 |
| three-signal (recency/citation omitted) | rerank .70 / cred .20 / base .10 |
| three-signal, no reranker available | base .70 / cred .30 |

Neither call site's effective scoring changes; only the score *source* changes, for `ranking.py`, from BGE-only to the Cohere → BGE ladder.

`search/ranking.py:rerank_results` switches from calling `_bge_reranker()` directly to `cross_encoder_scores()` (Cohere → BGE ladder) and uses the shared `fuse_scores`. After this, `ranking.py` no longer imports `_bge_reranker`; only `reranker.py` touches models.

`recency_score` accepts a `published_at` epoch in addition to `year` / `published`, fixing the silent zero described in 1.3. It remains pure.

## 7. WITHDRAWN — Iteration Steering

**Withdrawn in revision 2.** The premise was that every run burns a wasted
iteration round because `needs_iteration` is unconditionally true. Measured:
6 rounds across 8 queries, with two queries correctly needing none. The
observation that `follow_up_questions_prompt` never sees the sources remains
true and remains worth fixing, but it is a quality improvement of unknown
size, not the repair of a systematic waste. Retained below unimplemented.

### 7-original (superseded) Iteration Steering

`prompts.follow_up_questions_prompt` gains a source-context parameter, so suggested questions reflect what was actually found.

`iteration.gap_query` changes its priority order:

1. The judge's `missing` string, when the run came through the MAYBE path and a gap was named.
2. The text of claims that failed verification — these mark exactly where evidence is thin.
3. The first follow-up question (current behavior).
4. `f"{query} evidence details"` (current final fallback).

All four remain anchored to the user's query via the existing `sufficiency.anchor_gap_query`, which is unchanged. The function stays pure.

## 8. Removals

| Removed | Note |
|---|---|
| `Synthesizer.synthesize()` | superseded by `synthesize_grounded` |
| `Synthesizer.answer()`, `prompts.follow_up_answer_prompt` | and `test_answer_frames_context`. Verified no coverage is lost: the live deep-dive path has its own prompt-injection test, `test_deep_dive_context_frames_client_content` (`tests/test_security_framing.py:62`) |
| `ResearchAgent.knowledge_size()`, `ResearchAgent.clear_knowledge()` | no caller |
| `ResearchAgent.run()` | and its tests; `run_streaming` is the only entry point |
| `GET /api/paper/{filename}`, `pdf_filename` computation | `data/papers/` is empty and never written |
| `DELETE /api/research/cache` and `ResearchService.clear_cache`, `ResearchAgent.clear_cache` | no caller. `_QueryCache` itself stays — `_top_up` reads it |
| `_make_comparison_table`'s metadata-fabricated fallback | the frontend filters exactly these rows out; on failure the table is simply empty |
| `HuggingFaceSearcher._search_models` and its fallback wiring | download counts and tags are not evidence |

**Comparison-table gating moves to the backend.** `COMPARE_KEYWORDS` and the intent check live in `search/query.py`, beside the existing `_classify_query` heuristics; when the query shows no comparison intent, `_make_comparison_table` is skipped entirely — one fewer LLM call on most runs. `ResearchResult.tsx` drops `hasCompareIntent` and renders whenever rows are present. One source of truth.

Deliberately **kept**: `knowledge_store.retrieve()`, `_rank_and_group`, `_apply_rerank_gate` and the `RESEARCH_SUFFICIENCY_ENABLED` flag. This change already alters grounding, budgets, output format and iteration steering at once; removing the escape hatch at maximum blast radius is the wrong sequencing. Revisit after the changes have run in production.

## 9. Measurement

`tools/research_probe.py` runs a fixed list of ~8 Vietnamese queries and records, per run:

```
claims extracted · claims grounded · grounded fraction · confidence
iteration rounds · sources into synthesis · context chars actually sent · wall time
chart_data produced (bool)      # feeds the deferred decision, requirement 5
comparison call made (bool)
```

Run once against current `main` for a baseline, once after. Cost is roughly 8 × $0.002.

**Stated limitation:** the probe does not score answer quality. It measures the mechanical signals this work targets, which are objectively measurable; answer quality is not assessed in this change.

**Falsification criterion:** the baseline is expected to show a grounded fraction near 0, confidence near 0, and exactly one iteration round on every query. If it does not, the diagnosis in section 1.1 is wrong and this design must be revisited before implementation continues.

### 9.1 Baseline result (2026-08-19) — criterion triggered

The criterion fired. Execution stopped before any behavior change.

| Metric | Predicted | Measured | Verdict |
|---|---|---|---|
| mean grounded fraction | ~0.0 | 0.396 | **falsifies 1.1** |
| mean confidence | ~0.0 | 0.607 | **falsifies 1.1** |
| iteration rounds | 8 of 8 | 6 of 8 | **falsifies 1.1** |
| mean context chars | ~7,000 | 7,203 | confirms 1.2 |
| charts produced | — | 1 of 8 | informs requirement 5 |
| comparison rows | — | 4 on all 8 queries, 1 query had compare intent | confirms 1.5 |
| mean wall seconds | — | 75.2 | — |

Two probe defects were found and fixed before this run, both of which had
made the first attempt read as a total pipeline failure:
`ResearchAgent.run_streaming` is `yield from _run_core(...)`, and a
yield-from expression discards the delegated generator's return value, so
`StopIteration.value` was always `None`; and `synthesizer.py` binds
`extract_claims` into its own namespace at import, so patching
`grounding.extract_claims` never reached the call site.

**Environment:** Weaviate Cloud returned 503 throughout and Semantic Scholar
failed on every query. The knowledge-gate path was therefore never exercised
— this baseline measures the live-search path only, and any comparison run
must reproduce the same conditions or it compares two different things.

## 10. Testing

| Target | Cases |
|---|---|
| `quote_support` | substring match; curly-quote / dash / whitespace normalization; partial token match; quote under 20 chars rejected; empty quote |
| `ClaimAuditor` fallback | <30% quote-grounded with ≥3 claims invokes `fallback_scorer`; ≥30% does not |
| `filter_by_anchor_relevance` | Vietnamese query against English sources keeps everything via the 80% guard; a single genuinely off-topic result is still dropped |
| `capabilities_for` | known model; unknown model default; resolution through `DEFAULT_MODEL`; derived budget values |
| `_call_structured` | capability false uses the legacy path; a raising structured call falls back and still yields a valid result |
| `fuse_scores` | weights sum to 1.0 in both blends; monotonic in the rerank score |
| `recency_score` | `published_at` epoch, `year`, and `published` shapes all resolve |
| `gap_query` | priority order across judge-missing, ungrounded claims, follow-up, and final fallback |
| Comparison gating | no comparison intent skips the call; intent present makes it |
| Regression | the existing suite stays green. The 4 failures in `tests/test_news_fetcher.py` pre-date this work and are unrelated |

## 11. Sequencing

1. Probe and baseline — before any change, for a comparison point.
2. Grounding (section 3) — the largest change, independent.
3. Capability table and budget (section 4).
4. Structured output (section 5) — depends on 4.
5. Rerank unification (section 6) — independent.
6. Iteration steering (section 7) — depends on 3.
7. Removals (section 8) — independent.
8. Probe again and compare.

## 12. Out of Scope

*(Revision 2 additions: quote-anchored grounding verification (section 3) and
iteration steering (section 7), both withdrawn for lack of a measured defect.
Determining whether rejected claims are rejected correctly or falsely — the
open question in section 1.1 — is separate work requiring qualitative review,
not a metric.)*

- **Removing `chart_data`.** A product decision, deferred until the probe reports how often it produces anything.
- **Auditing chart and comparison figures against sources.** Fabricated numbers remain possible (section 5).
- **Removing the `RESEARCH_SUFFICIENCY_ENABLED` kill switch and the legacy retrieval path** (section 8).
- **Gating Ollama out of `available_models()`** when no server is reachable. Real, small, but unrelated.
- **Answer-quality evaluation.** The probe measures mechanical signals only (section 9).
- **Call consolidation.** Considered and rejected: the seven synthesis calls already run in parallel, so merging them would not reduce latency and would cost fault isolation.

## 13. Results (2026-08-19)

### 13.1 What shipped

Tasks implementing sections 4, 5, 6 and 8. Sections 3 and 7 were withdrawn in revision 2 and never implemented.

| Metric | Baseline | After | Verdict |
|---|---|---|---|
| mean context chars sent | 7,203 | ~36,000 | goal met (§4.2) |
| comparison-table calls | 8 of 8 queries | 2 of 8 | goal met (§8) — both compare-intent queries |
| charts produced | 1 of 8 | 8 of 8 → **3 of 8** after the fix below | regression found and repaired |
| mean wall seconds | 75.2 | ~82–86 | accepted cost of larger context |

### 13.2 Chart regression, found and fixed

Structured output replaced the text path's `"NO_DATA"` sentinel with a `has_data: bool` field. The model answers that field true almost always, so charts went from 1 of 8 queries to 8 of 8. Chart values are LLM-generated numbers and, as section 5 already recorded, nothing verified them.

Fix: `ChartData` gained a `source_quote` field, and a pure `chart_is_supported()` check now requires the quote to appear verbatim in the context and to contain at least two of the plotted values, alongside a minimum of two label/value pairs. Charts fell to 3 of 8 — the surviving three each carry quotable numbers.

This is the one place quote-anchored verification was actually built, and it was justified by a measured defect rather than by the reasoning withdrawn in section 3.

### 13.3 Grounding drift: attributed by controlled A/B

The first comparison showed grounded fraction falling 0.396 → 0.301 and confidence 0.607 → 0.520. Two causes were confounded: claim extraction had begun running at `reasoning_effort="high"` over 5× more context, **and** the source mix differed (Semantic Scholar failed on every baseline query but none of the second run).

Both arms were then run back to back, varying only the effort setting. Source conditions stayed comparable — Semantic Scholar failed 106 vs 102 times, Weaviate 503 on 23 vs 20 occasions, context 35,978 vs 36,045 chars.

| | baseline | `high` | `none` |
|---|---|---|---|
| mean grounded fraction | 0.396 | **0.287** | **0.442** |
| mean confidence | 0.607 | 0.506 | 0.543 |
| iteration rounds | 6 | 7 | 4 |
| mean wall seconds | 75.2 | 86.4 | 81.6 |

`none` was higher than `high` on 6 of 8 queries. The pattern matches the interpretation fixed in advance: reasoning effort is the cause of the drift, not the source mix.

**What this does not establish.** `is_grounded` is a lexical proxy. Higher reasoning effort plausibly produces more cross-source synthesized claims, which by construction share fewer tokens with any single cited source. A lower score is therefore consistent with both worse claims and better ones; this measurement cannot tell them apart.

**What it does establish**, independent of claim quality: `high` costs more wall time and more top-up iteration rounds, while displaying fewer claims and lower confidence to the user.

**Decision.** Claim extraction no longer sends a `reasoning_effort` at all, restoring the behavior it had before structured output was introduced. `RESEARCH_CLAIM_EFFORT` keeps the knob available for the qualitative comparison that would settle the open question.

### 13.4 Environment findings — recorded, not addressed

Both outside this work's scope. Recorded because they change how the numbers above should be read.

1. **The cross-encoder reranker never ran.** BGE fails to load with `XLMRobertaTokenizer has no attribute prepare_for_model`, a FlagEmbedding/transformers version conflict, and no `COHERE_API_KEY` is configured. Every run in this measurement — baseline and all three afterwards — fell back to credibility-only scoring. The unification in section 6 is therefore correct by construction and by unit test, but its primary path has never executed here. Production ranking quality is lower than the design assumes.

2. **Weaviate Cloud returned 503 throughout.** The knowledge-gate path (`sufficiency.assess`, `retrieve_candidates`, the top-up branch) was never exercised in any measurement. Every number above describes the live-search path only.

### 13.5 Open question, still open

Section 1.1 closed the question of whether grounding is inert — it is not. It did not settle whether rejected claims are rejected *correctly* or *falsely*. That needs a person reading real claims against real sources; no metric in this document answers it, and the A/B above makes it more pointed rather than less, since the two effort settings disagree on roughly a third of claims.

## 14. Knowledge-gate path, measured for the first time (2026-08-25)

Weaviate was restored, so the branch of `_run_core` that had never been observed in any earlier measurement could finally be run. The store held 1,199 chunks accumulated from previous probe runs of these same eight queries — the most favourable corpus this path will ever see.

### 14.1 Gate outcomes

| Decision | Queries |
|---|---|
| `top_up` | **7 of 8** |
| `search` (store empty for that query) | 1 of 8 |
| `reuse` | **0 of 8** |
| `degraded` | 0 |

The tier-2 LLM judge ran on six queries and answered "insufficient" on all six.

Wall time rose to 92.6s from 86.4s / 81.6s on the live-search-only runs: the gate adds a retrieval and a judge round-trip per query.

### 14.2 The candidate set is thin, and that is not why reuse fails

`retrieve_candidates` surfaces only 1-5 chunks out of 1,199. The cause is a units mismatch: `HybridFusion.RELATIVE_SCORE` normalises scores *within the returned batch*, so the best hit is 1.0 by construction and the third is already ~0.25, while `KNOWLEDGE_CANDIDATE_THRESHOLD = 0.65` is an absolute cut. An absolute threshold is being applied to a relative score.

Lowering the threshold does widen the candidate set substantially:

| Threshold | Candidates per query |
|---|---|
| 0.65 | 1 - 5 |
| 0.40 | 5 - 14 |
| 0.25 | 7 - 24 |
| 0.10 | 15 - 37 |

Tier-1 coverage is 1.00 at every level, so tier 1 was never the constraint. Running the judge directly at both thresholds settles what the extra sources buy:

| | reuse fires |
|---|---|
| threshold 0.65 | 0 of 8 |
| threshold 0.40 | 1 of 8 |

**Tripling the evidence changes almost nothing.** The judge rejects 14 sources for the same reasons it rejects 2. The threshold mismatch is real and worth recording, but it is not the reason reuse never happens, and retuning it would not deliver the reuse path.

### 14.3 What this means — the design is behaving as specified

`_top_up` merges the stored sources with the new search results (`agent.py`: `combined = deduplicate_results(base_sources + extra)`), so stored knowledge feeds the answer on 7 of 8 queries. What never happens is *avoiding a search*.

Measured against the requirements the RAG design (2026-07-25 §2) actually stated:

1. "Shallow answers are the worse failure. Spending extra seconds to verify or supplement beats answering thinly from stale data."
2. "Partial knowledge is topped up, not discarded."

`top_up` on 7 of 8 queries is requirement 2, exactly. A judge that demands evidence to answer "fully and specifically" before reusing is requirement 1, exactly. **Reuse at 0 of 8 is not a defect; it is the stated preference being honoured.**

The earlier framing in this section's first draft — "the knowledge store costs more than it saves" — measured the right numbers and drew the wrong conclusion from them, by scoring the feature against a goal (cache hits) that its own design document had explicitly rejected in favour of another.

### 14.4 The one question this does leave open

The judge answered "insufficient" on 15 of the 16 evaluations run here, across two very different evidence volumes. A decision procedure whose output barely varies with its input is weak value for a per-query LLM round-trip, whatever its verdict happens to be.

That is a cost question, not a correctness question, and it has a cheap answer available: `RESEARCH_SUFFICIENCY_ENABLED=False` skips the judge, at which point a MAYBE state reuses whatever was retrieved. Deciding between them needs the qualitative comparison that section 13.5 already flags as the outstanding work — whether answers built from stored chunks are actually worse. No metric here answers that.

**Not changed.** Both the threshold and the judge are left exactly as they are. Retuning either on this evidence would be changing behaviour to improve a number that was never the goal.
