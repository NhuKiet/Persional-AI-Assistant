# Research: RAG vs Live-Search Decision Design

**Date:** 2026-07-25

**Revision:** 3 — revised after technical review (`docs/reviews/rag-vs-live-search-spec-review.docx`) and a follow-up review covering cancellation, the SSE contract, persistence placement, and gap-query anchoring. Section 16 records which review findings were accepted and which were declined, with reasoning.

**Status:** Approved design; awaiting written-spec review

**Scope:** Replace the single static-threshold gate that decides between answering from the knowledge store and running a live search. Does not change how search results are found, ranked, chunked, or embedded, beyond the retrieval and persistence changes in sections 5 and 9.

## 1. Problem

After a research run, sources are chunked, embedded, and stored in Weaviate. On the next question, `ResearchAgent.run_streaming` decides between reusing that stored knowledge and searching all seven sources live. The decision rests on two things:

1. `KnowledgeStore.retrieve()` returning any hit above `KNOWLEDGE_THRESHOLD` (0.65).
2. `ResearchAgent._is_relevant()`, which is a no-op — it returns `bool(results)` and nothing more.

A similarity score answers "is this about the same topic?" It does not answer "does this content actually answer *this* question?" The two are not the same, and the gap fails in both directions:

- **Reuse that should have searched.** Question 1 stores "what is YOLOv11". Question 2 asks to compare YOLOv11 and YOLOv8 backbones by FLOPs. The stored chunks still score above 0.65 because the vocabulary overlaps, so the system answers from shallow stored content and never searches. The user gets a thin answer with no signal that it was thin.
- **Search that should have reused.** A deeper follow-up phrased differently enough drops below 0.65, so a full seven-source search runs even though relevant material is already stored.

The live-search branch has a self-correction loop (`needs_iteration` / `gap_query`, capped by `RESEARCH_MAX_ITERATIONS`). The RAG branch has none: it calls `synthesize_rag()` and returns, with no claims, no confidence, and no limitations. The cheaper path is also the one with no quality signal attached.

Two further defects, identified during review:

- **Results found by the iteration loop are never stored.** `knowledge.add_results()` is called only on the live-search branch; `_iteration_step` does not store. Whatever a top-up search finds is discarded after answering, so the next question re-searches the same gap.
- **Time-decay silently disqualifies data.** `_rank_and_group` compares the *decayed* score against `KNOWLEDGE_THRESHOLD`, so age does not merely lower rank — it eliminates. Section 5 covers this.

## 2. Requirements

Confirmed with the user during design:

1. **Shallow answers are the worse failure.** Spending extra seconds to verify or supplement beats answering thinly from stale data.
2. **Partial knowledge is topped up, not discarded.** When stored knowledge covers part of the question, keep it and search only for the missing part, then synthesize from both.
3. **Freshness is per question type.** Conceptual questions tolerate old data; questions about current state of the art, benchmarks, versions, or prices do not.

## 3. Retrieval States

The gate resolves to exactly one of four states. Each has distinct behavior; collapsing any two of them reintroduces the problem this design exists to solve.

| State | Condition | Behavior |
|---|---|---|
| `EMPTY` | No candidates retrieved | Full live search, synthesize, ground, store. |
| `STALE` | Candidates exist, but none fall inside the TTL for this question type | Live search. Stored sources are **not** carried into synthesis (see 16.1). |
| `THIN` | Fresh candidates exist but cover the question poorly | Keep the fresh stored sources, run a top-up search, merge stored + new. No judge call. |
| `MAYBE` | Fresh candidates exist with adequate coverage | Tier 2 judge decides reuse vs top-up. |

Coverage is always computed over the **fresh subset only**, never the full candidate set. A single fresh but irrelevant snippet must not make nine stale sources look current.

## 4. Flow

```text
original_query
   -> contextualize_query(history)  [existing behavior]
   -> effective_query
   -> retrieve_candidates(effective_query)   raw score + freshness metadata
   |
   +-- EMPTY --------> live search ------------------------+
   |                                                       |
   v                                                       |
TIER 1  assess(effective_query, candidates)   pure, no LLM |
   |                                                       |
   +-- STALE -------> live search (stored dropped) --------+
   +-- THIN --------> top-up search -> merge --------------+
   |                                                       |
   v MAYBE                                                 |
TIER 2  judge_sufficiency(...)   one LLM call, hardened    |
   |                                                       |
   +-- sufficient --> grounded RAG ------------------------+
   +-- insufficient -> top-up search -> merge -------------+
                                                           |
   +-------------------------------------------------------+
   v
TIER 3  synthesis -> grounding -> conditional iteration
        -> persist newly fetched sources
        -> emit knowledge_decision + limitations
```

### 4.1 Why tiers rather than one mechanism

Each tier alone is insufficient:

- Deterministic signals alone cannot distinguish "what is YOLOv11" from "compare YOLOv11 and YOLOv8 backbone FLOPs" — both cover the same tokens. This is the original problem restated with more dimensions.
- An LLM judge alone spends a call on cases that need no judgment, such as six-month-old data for a state-of-the-art question.
- Synthesizing first and reacting to weak grounding alone costs a full seven-call synthesis before discovering the material was thin.

## 5. Retrieval Layer Changes

### 5.1 The time-decay conflict

`_rank_and_group` currently does this:

```python
d_score = h.score * math.exp(-age_days / 60.0)
if d_score < threshold:      # threshold = KNOWLEDGE_THRESHOLD = 0.65
    continue
```

The threshold is applied to the **decayed** score, so age eliminates rather than demotes. A chunk with a perfect hybrid score of 1.0 is discarded after roughly 25.8 days; a more typical 0.8 is discarded after roughly 12.5 days. A 180-day TTL for stable questions could therefore never take effect — the data is gone long before the TTL is consulted.

### 5.2 `retrieve_candidates()`

Add a new method rather than changing `retrieve()`:

- `retrieve_candidates(query)` filters on the **raw** hybrid score for relevance, uses time-decay only for **ordering**, and returns freshness metadata alongside each result.
- `retrieve()` is left exactly as it is.

Two reasons for a new method instead of an edit: the kill switch in section 12 must restore legacy behavior byte-for-byte, and `retrieve()` has callers and tests that should not shift underneath this change.

Relevance filtering and freshness filtering become separate concerns, applied at separate layers, with one policy each.

### 5.3 The candidate threshold is relative, not absolute

`retrieve_candidates` uses a **new** setting, `KNOWLEDGE_CANDIDATE_THRESHOLD`, rather than reusing `KNOWLEDGE_THRESHOLD`. The two are not interchangeable: the legacy value is applied to a decayed score, this one to a raw score, and giving them one name would tie two different policies together.

More importantly, the query runs with `HybridFusion.RELATIVE_SCORE`, which normalizes scores **within a single query's result set**. The top hit trends toward 1.0 whether the match is excellent or merely the best of a weak field. A fixed cutoff on that score is therefore a *relative* filter — "how far below the best hit is this?" — and not an absolute quality bar. It cannot be read as a cross-query measure of relevance.

This is why coverage (section 6.4) and the tier 2 judge exist: they supply the absolute signal the hybrid score does not. The threshold's job is only to trim the tail of a single result set.

## 6. Freshness Model

### 6.1 Two timestamps, named honestly

| Field | Meaning | Availability |
|---|---|---|
| `stored_at` | When the chunk was written to Weaviate | Always — the existing `timestamp` property |
| `published_at` | When the source material was published | Academic sources only (see 6.2) |

The existing `timestamp` property is set by `ts = time.time()` **inside `add_results`** (`knowledge_store.py`), at write time. It is `stored_at`, not `fetched_at`, and this design names it accordingly rather than treating the two as synonyms.

The distinction gets larger under this design, not smaller. Section 9 moves persistence to *after* grounding and iteration, so the gap between fetching a source and storing it grows from near-zero to the length of a synthesis run. That gap is bounded by minutes; TTLs are measured in days, so `stored_at` remains a sound freshness proxy. Capturing a true `fetched_at` at search time is possible but buys nothing at this resolution, and is not specified here.

Effective evidence age uses `published_at` when known, falling back to `stored_at`. A 2020 paper indexed this morning is not current evidence for a question about state of the art, and `stored_at` alone cannot express that.

### 6.2 Implementation constraint: `extra` is not persisted

Academic searchers already capture publication data — `search/academic.py` writes `published` and `year` into `SearchResult.extra`. **But `KnowledgeStore.add_results` does not store `extra`.** The Weaviate schema has eleven properties (`content`, `sectionHeading`, `source`, `sourceCategory`, `url`, `title`, `query`, `timestamp`, `score`, `chunkIndex`, `parentContent`), none of which carries publication date. Publication data is therefore lost on write and unavailable on read.

Implementing `published_at` requires:

1. Adding **two** properties to the collection schema: `publishedAt` (a date, when the source gives one) and `publishedYear` (an integer fallback).
2. Populating them in `add_results` from `result.extra` — arxiv supplies a full date in `published`, while Semantic Scholar and OpenAlex supply only `year`.
3. Handling existing collections: `_ensure_schema` returns early when the collection already exists, so new properties in the definition will not reach a live collection. They must be added explicitly to an existing collection, and code must tolerate their absence.

Chunks written before this change have neither property. They fall back to `stored_at`, which is the current behavior and therefore no regression.

### 6.2.1 Computing age from year-only data

`publishedYear` has one-year resolution, so an age derived from it is ambiguous by up to twelve months. The rule is to resolve that ambiguity **conservatively**, treating a year-only value as **January 1** of that year — the oldest date it could mean.

This follows requirement 1: over-estimating age sends a borderline case to a top-up search, while under-estimating it answers from data that may be a year older than assumed. When `publishedAt` carries a full date, it is used directly and no such rounding occurs.

### 6.3 Freshness classification

Bilingual, because the application is Vietnamese-first.

| Class | TTL | Trigger terms |
|---|---|---|
| `volatile` | 7 days | sota, benchmark, latest, newest, current, mới nhất, hiện tại, phiên bản, version, release, pricing, giá, xu hướng, trend, top, best |
| `stable` | 180 days | là gì, what is, định nghĩa, definition, nguyên lý, principle, kiến trúc, architecture, hoạt động thế nào, how does, giải thích, explain, lịch sử, history |
| `default` | 30 days | everything else |

`volatile` is checked before `stable`. "YOLOv11 mới nhất là gì" matches both and must classify as volatile.

**Years are detected dynamically, never hardcoded.** A `\b20\d{2}\b` match is a volatile signal when the matched year is greater than or equal to `current_year - 1`. Hardcoding "2025, 2026" would silently expire the classifier.

### 6.4 Coverage

`query_coverage` is the fraction of the question's distinct content tokens appearing anywhere in the concatenated content of the **fresh subset**:

```text
coverage = |tokens(query) & tokens(fresh subset content)| / |tokens(query)|
```

Tokens are lowercased, unicode-aware (section 7.2), and at least three characters long. An empty token set for the question yields coverage 1.0, deferring to tier 2 rather than forcing a search on degenerate input.

## 7. Sufficiency Module

### 7.1 `backend/app/features/research/sufficiency.py`

Follows the convention established in `grounding.py`: pure logic separated from I/O, LLM injected as a callable, so the module is testable without an LLM, without Weaviate, and without OpenAI.

```python
# Tier 1 - pure, deterministic
def classify_freshness(query: str, now=None) -> str        # volatile | stable | default
def fresh_subset(sources: list, ttl_days: int, now=None) -> list
def query_coverage(query: str, sources: list) -> float
def assess(query, candidates, now=None) -> str             # EMPTY | STALE | THIN | MAYBE

# Tier 2 - LLM injected
def judge_sufficiency(query, sources, llm_call, parse_obj) -> tuple[bool, str | None]
```

### 7.2 Vietnamese tokenization

`grounding.tokenize()` uses the regex `[a-z0-9]+`, which does not match accented characters. A Vietnamese question such as "kiến trúc mạng nơ-ron hoạt động thế nào" would lose nearly every token, driving coverage to roughly zero, classifying every Vietnamese question as `THIN`, and making tier 1 useless for the application's primary language.

`sufficiency.py` carries its own unicode-aware tokenizer. `grounding.tokenize` is left untouched so existing grounding behavior and its passing tests are unaffected.

### 7.3 New settings

| Setting | Default | Defined in |
|---|---|---|
| `RESEARCH_SUFFICIENCY_ENABLED` | `True` | Kill switch; `False` restores legacy `retrieve()` and the old gate exactly (section 12) |
| `KNOWLEDGE_CANDIDATE_THRESHOLD` | `0.65` | Raw-score relevance cutoff for `retrieve_candidates`, distinct from `KNOWLEDGE_THRESHOLD` (section 5.3) |
| `KNOWLEDGE_TTL_VOLATILE_DAYS` | `7` | Section 6.3 |
| `KNOWLEDGE_TTL_STABLE_DAYS` | `180` | Section 6.3 |
| `KNOWLEDGE_TTL_DEFAULT_DAYS` | `30` | Section 6.3 |
| `KNOWLEDGE_COVERAGE_MIN` | `0.6` | Coverage below this is `THIN` (section 6.4) |
| `RESEARCH_JUDGE_TIMEOUT_SECONDS` | `20` | Judge deadline; on expiry the verdict is *insufficient* (section 12.2) |

`RESEARCH_SUFFICIENCY_ENABLED` mirrors the existing `RESEARCH_GROUNDING_ENABLED` convention. `KNOWLEDGE_THRESHOLD` keeps its current value and meaning; it is not repurposed.

## 8. Judge Hardening

Source content is untrusted third-party text and may contain instructions aimed at the judge — for example, text engineered to assert that the context is sufficient, suppressing a search that would have corrected it.

**Prompt assembly:**

- Prefix `UNTRUSTED_GUARD`; wrap every source body in `frame_untrusted()`, exactly as `grounding._claim_extraction_prompt` does.
- Cap each source at 400 characters and the assembled context at a fixed total.
- Reference sources by `SearchResult.id` (a deterministic `sha256(url|title)` prefix that already exists) rather than by position.

**Response validation** — anything failing validation is treated as *insufficient*, per requirement 1:

- `sufficient` must be a genuine boolean. A truthy string such as `"yes"` is rejected, not coerced.
- `missing` must be a string of at most 200 characters, with control characters stripped.

### 8.1 The gap query is anchored, never substituted

The judge's `missing` string is **never used as the outbound search query on its own.** The top-up query is always the user's question with the validated gap appended:

```text
top_up_query = f"{effective_query} {validated_missing}"
```

An earlier revision of this design instead required `missing` to share at least one token with `effective_query`. That rule is too weak to rely on: injected text need only echo a single keyword from the question to satisfy it, and is then free to steer the remainder of the search wherever it likes. Token overlap is a test the attacker controls.

Anchoring removes the attack surface rather than testing for it. Because `effective_query` is always present in full, a manipulated `missing` can add noise to the search but cannot replace its subject. The worst outcome degrades to "searched the user's question with junk appended", which the ranking pipeline already tolerates.

Additional constraints:

- Content tokens of `effective_query` — its named entities and subject terms — are present by construction, since the whole query is included verbatim.
- The combined query is capped in length, with `effective_query` taking precedence if truncation is needed. The user's question survives; the appended gap is what gets cut.
- If `missing` fails validation or is empty, the top-up runs on `effective_query` alone.

## 9. Persistence of Newly Fetched Sources

Every path that fetches new material stores it, so the next question can reuse it. This closes the defect in section 1 where top-up results evaporated.

### 9.1 One persistence point, and the old ones must move

`add_results` currently has **two** call sites — `agent.py` line 263 in `run()` and line 443 in `run_streaming()` — both inside the live-search branch, both firing *before* synthesis. Adding a tier 3 persistence step without removing them stores live-search results twice on every run.

Both existing calls are **deleted** and replaced by a single call in the shared tier 3 tail, after grounding. One call site, every path, no duplicates and no gaps.

Moving persistence after synthesis has a second benefit. The current placement blocks the answer: chunking, embedding, and the Weaviate write all complete before the `synthesizing` event is emitted, so the user waits through work that contributes nothing to their answer. After the move, that cost falls outside the user's critical path.

### 9.2 What gets stored

`_top_up()` returns **two** lists rather than one:

- `merged_sources` — the deduplicated, reranked set used for synthesis.
- `newly_fetched_sources` — only the sources fetched during this run.

Only `newly_fetched_sources` is passed to `add_results`. Sources originating from `retrieve_candidates` are already in Weaviate and must never be written back; doing so multiplies chunk copies on every follow-up question about the same topic.

The new set is computed **after** merge and dedup, by `SearchResult.id` difference against the retrieved candidate ids. Taking it after merging matters: a newly fetched source dropped by dedup as a near-duplicate of stored content should not be stored either.

On the `EMPTY` and `STALE` paths every source is newly fetched, so the two lists coincide.

Storage failure remains non-fatal and never blocks the answer. No additional quality gate is introduced here; see 16.2.

## 10. Degraded Results and Decision Reporting

When the gate concludes that stored knowledge is insufficient and the top-up search then fails, returns nothing, or times out, the system must not present a confident, complete-looking answer assembled from material it has already judged inadequate.

In that case:

- Answer from what is actually supported.
- Append a limitation naming the failure: no supplementary sources were found for the missing dimension.
- Cap confidence at a low ceiling regardless of the computed value.
- Emit `knowledge_decision` with `decision: "degraded"`.

### 10.1 The `knowledge_decision` SSE event

The event is a contract, not a debug log: contract tests and the frontend both read it, so every field is required and every value is drawn from a closed set.

```json
{"type":         "knowledge_decision",
 "decision":     "reuse" | "top_up" | "search" | "degraded",
 "reason":       "sufficient" | "thin" | "insufficient" | "empty" | "stale" | "top_up_failed",
 "stored_count": 0,
 "fresh_count":  0,
 "new_count":    0}
```

| Field | Meaning |
|---|---|
| `stored_count` | Candidates returned by `retrieve_candidates` before any freshness filtering |
| `fresh_count` | Subset of those candidates passing the TTL for this question type; never greater than `stored_count` |
| `new_count` | Sources newly fetched during this run and surviving merge — the set persisted in section 9.2 |

Only these decision/reason pairs are valid:

| `decision` | `reason` | State |
|---|---|---|
| `reuse` | `sufficient` | `MAYBE`, judge approved |
| `top_up` | `thin` | `THIN` |
| `top_up` | `insufficient` | `MAYBE`, judge rejected |
| `search` | `empty` | `EMPTY` |
| `search` | `stale` | `STALE` |
| `degraded` | `top_up_failed` | Top-up produced nothing (section 10) |

Exactly one `knowledge_decision` is emitted per run, before the `synthesizing` event. On `reuse`, `new_count` is 0. On `search`, `fresh_count` is 0 for `stale` and both counts are 0 for `empty`.

`useResearch.ts` dispatches through an `if / else if` chain that ignores unrecognized event types, so emitting this does not break the current frontend. Rendering it is deliberately deferred to separate work.

## 11. Cost Model

`synthesize()` issues six LLM calls (two for summaries, one each for key points, comparison, chart, follow-ups); `synthesize_grounded()` adds claim extraction for seven. `synthesize_rag()` issues one; with grounding attached, two.

Tier 1 never concludes "reuse" on its own — it emits `EMPTY`, `STALE`, `THIN`, or `MAYBE`, and only tier 2 authorizes reuse. Every reuse therefore pays for the judge call:

| Path | LLM calls |
|---|---|
| Reuse (`MAYBE` → sufficient) | 3 — judge, `synthesize_rag`, claim extraction |
| Top-up (`MAYBE` → insufficient) | 8 — judge + `synthesize_grounded` |
| Top-up (`THIN`, no judge) | 7 — `synthesize_grounded` |
| Live search (`EMPTY` / `STALE`) | 7 — `synthesize_grounded` |

`contextualize_query` and `expand_query` are pre-existing costs on their respective paths and are excluded from these totals.

Three calls for reuse is accepted deliberately. Making tier 1 authorize reuse on deterministic signals alone would save one call by reintroducing exactly the failure mode described in section 1.

## 12. Error Handling

Every failure path resolves toward searching more, following requirement 1.

| Condition | Behavior |
|---|---|
| Weaviate unavailable, retrieval raises | Already caught in `agent.py`; candidates empty; `EMPTY` → live search. |
| LLM judge raises | Treated as insufficient; top-up search. |
| Judge returns unparseable JSON | Treated as insufficient; top-up search. |
| Judge response fails schema validation (section 8) | Treated as insufficient; top-up search. |
| `missing` shares no token with `effective_query` | Discarded; `effective_query` used as the gap query. |
| Top-up search fails, times out, or returns nothing | Degraded result per section 10. |
| Embedding fails during merge dedup | `deduplicate_results` already catches this and returns its input unchanged. |
| Persistence fails | Logged, non-fatal; the answer is unaffected. |
| `RESEARCH_SUFFICIENCY_ENABLED` is `False` | Legacy `retrieve()` and the old gate; behavior identical to today. |

### 12.1 Missing timestamp

Legacy chunks may lack usable freshness metadata. The rule is asymmetric by question type:

| Condition | Behavior |
|---|---|
| Missing timestamp + `volatile` question | `STALE` → full live search |
| Missing timestamp + `stable` question | Allow tier 2 to judge |
| Missing timestamp + `default` question | Allow tier 2 to judge |

A source of unknown age is excluded from the fresh subset. For a volatile question that empties the fresh subset, which is the definition of `STALE` in section 3 — so the behavior follows from the state machine rather than being a special case, and it is full live search, not a top-up.

Treating every missing timestamp as stale would invalidate the entire existing knowledge store at once. Treating every one as fresh would answer state-of-the-art questions from data of unknown age. The split follows the risk.

### 12.2 Cancellation during the judge call

A check placed before a blocking call cannot cancel that call once it has started. An earlier revision specified a pre-call check while also claiming cancellation *during* the judge — those cannot both be true. This design resolves it in favor of real cancellation, because the judge runs on whatever provider the user selected and a slow local model can hold that call for tens of seconds.

The judge is submitted to the agent's existing `ThreadPoolExecutor` and awaited in a bounded polling loop that wakes on a short interval to test `cancel_event`. Cancellation is therefore observable while the call is in flight; the abandoned future is left to finish and its result discarded, matching how `_search_all` already handles cancelled work.

The same loop enforces `RESEARCH_JUDGE_TIMEOUT_SECONDS`. A judge that hangs must not stall the run: on timeout the verdict is *insufficient*, sending the request to a top-up search per requirement 1.

Cancellation is also checked before submitting, so an already-cancelled run never starts the call at all.

## 13. Scope Invariants

**Query identity.** The decision gate, retrieval, search, and synthesis all operate on `effective_query` — the output of `contextualize_query` against session history. `output.query` and everything the UI displays retain the user's `original_query`. This is current behavior (`agent.py`, `run_streaming`) and is recorded here as an invariant so the gate is not accidentally wired to the raw input.

**Knowledge scope.** The Weaviate collection is global, not per session. The gate queries global knowledge using a query contextualized by the *current* session's history. This is acceptable for the present single-user deployment. A multi-user deployment would require tenant or user scoping; that is out of scope here and noted so the assumption is explicit rather than accidental.

**Both entry points.** `run()` and `run_streaming()` call one shared decision helper, so the two paths cannot drift. `run()` has no history parameter and passes `None`, which is equivalent to today's behavior for that path.

## 14. Testing

New file `tests/test_research_sufficiency.py`, runnable with no LLM, no Weaviate, and no OpenAI, since all dependencies are injected.

**Tier 1, pure:**

- `classify_freshness` — bilingual table, volatile-beats-stable ("YOLOv11 mới nhất là gì"), dynamic current-year detection with no hardcoded years.
- `query_coverage` — accented Vietnamese input (the failure section 7.2 exists to prevent), empty sources, full coverage.
- `fresh_subset` — mixed fresh and old sources; a fresh but irrelevant source must not make the whole set count as fresh.
- `assess` — each of `EMPTY`, `STALE`, `THIN`, `MAYBE`; recent `stored_at` with old `published_at` must classify by publication date; year-only `publishedYear` resolves to 1 January; missing timestamp with a volatile question must not reach tier 2.

**Tier 2:**

- Valid JSON, malformed JSON, and a raising `llm_call` — both failure modes fall back to insufficient.
- `sufficient: "yes"` (string, not boolean) is rejected.
- A source containing injected text asserting sufficiency does not by itself produce a reuse decision.
- **The top-up query always contains `effective_query` in full**, including when `missing` is adversarial, empty, or shares no tokens with the question.
- Length-capped combination truncates the appended gap, never the user's question.
- Judge timeout yields *insufficient* rather than stalling the run.

**Integration:**

- Time-decay does not eliminate a source before the TTL policy sees it.
- `THIN` merges stored and new sources rather than discarding stored ones.
- **Persistence fires exactly once per run** — the removed call sites at `agent.py` 263 and 443 do not also store, so live-search results are written once, not twice.
- Newly fetched sources are persisted; sources originating from `retrieve_candidates` are not re-stored.
- A newly fetched source dropped by merge dedup is not persisted.
- A subsequent question reuses what a top-up stored.
- Top-up failure yields a degraded result with limitations and capped confidence, not a full-confidence answer.
- The kill switch restores legacy behavior exactly.
- `knowledge_decision` is emitted exactly once per run, before `synthesizing`, with a valid decision/reason pair and counts satisfying `fresh_count <= stored_count`.
- Cancellation **while the judge call is in flight** is observed without waiting for it to return.
- `run()` and `run_streaming()` reach the same decision for the same inputs.

All 278 existing tests must remain green.

## 15. Out of Scope

- Claim-first synthesis and reducing the synthesizer's LLM call count — separately sequenced work.
- Deduplication on write and a `cleanup_old` retention policy for the knowledge store — a distinct storage concern (see 16.2).
- Merging the duplicated `run()` and `run_streaming()` pipelines beyond the shared decision helper in section 13.
- Frontend rendering of `knowledge_decision`; the backend emits the event first.
- Multi-user tenant scoping of the knowledge collection.

## 16. Review Disposition

Findings from `docs/reviews/rag-vs-live-search-spec-review.docx` were verified against the code. All were accepted except the two below, which are declined with reasoning.

### 16.1 Declined: stale sources as "background, not evidence for time-sensitive claims"

The review proposes that on `STALE`, old sources remain available as background but are barred from supporting time-sensitive claims. This requires per-claim time-sensitivity classification, which does not exist: `Claim` carries only `evidence_type` (direct / inference / opinion / uncertain), and `ClaimAuditor` has no notion of temporal validity. Adding it means extending the claim model, changing the auditor, and depending on a further LLM judgment about which claims are time-sensitive — significant machinery for an unclear gain.

This design uses the simpler rule instead: on `STALE`, stored sources are not carried into synthesis at all. Live search supplies the evidence and existing grounding operates unchanged. If a future need for background context emerges, it can be added then.

### 16.2 Declined: a quality gate before persisting top-up sources

The review proposes storing top-up sources only after grounding, in a validated state. Today the pipeline stores with **no quality gate whatsoever**, and does so *before* synthesis. Introducing a gate on the top-up path alone would leave two different storage policies in one system — harder to reason about, not safer.

Beyond that, "store only validated sources" is a change to overall storage policy, belonging with the storage work already scoped out in section 15 (deduplication on write, retention). This design therefore persists newly fetched sources the same way live-search results are persisted today, and leaves the policy question to that workstream, where it can be answered once for every path.
