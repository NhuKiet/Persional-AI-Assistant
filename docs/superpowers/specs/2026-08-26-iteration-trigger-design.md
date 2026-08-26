# Bounded Iteration: Fixing the Trigger

**Date:** 2026-08-26

**Status:** Approved design; awaiting written-spec review

**Scope:** Change `iteration.needs_iteration` so a supplementary research round fires only when the evidence is genuinely weak, not merely when few claims were extracted.

Does not change: `gap_query`'s steering, `RESEARCH_MAX_ITERATIONS`, the loop in `_run_core`, or anything about how a round is executed once triggered.

## 1. Problem

### 1.1 What was measured

The loop's behavior was unknown. On the standard probe set it fires 0 of 8 times, and before the grounding repair it fired 6 of 8 — but every one of those firings was caused by claims being falsely empty, so no legitimate firing had ever been observed.

`tools/iteration_probe.py` was written to answer two questions on six deliberately hard queries (pinned versions, exact figures, niche Vietnamese subjects — the shapes most likely to return thin evidence).

**Question 1: does the loop fire for a legitimate reason?** Yes — 2 of 6. It is not dead code, which removes the case for deleting it outright.

**Question 2: when it fires, does it help?** One firing helped, one hurt.

| | PhoGPT-4B / VMLU | YaRN alpha-beta |
|---|---|---|
| Triggered by | 0 claims **and** confidence 0.0 | 2 claims < 3, **confidence already 1.0** |
| Gap query | near-restatement of the original question | drifted to "nên chọn … dựa trên" |
| New sources fetched | 6 | 1 |
| Result | claims 0 → **1**, confidence 0.0 → **1.0** | claims 2 → **1**, confidence unchanged |
| Verdict | genuinely helped | **made it worse** |

The run summary reported `mean_claims_delta: 0.0` — the average of −1 and +1. That figure hides the entire finding; only the per-round record shows it. A metric averaged across opposite outcomes is worse than no metric.

### 1.2 The trigger conflates two different situations

```python
if len(output.claims) < min_grounded:   # min_grounded = 3
    return True
if output.confidence is None or output.confidence < 0.5:
    return True
```

The YaRN case had **2 claims at confidence 1.0** — well-grounded evidence, merely narrow, because the question itself is narrow. The loop fired anyway, fetched one more source, and the re-synthesis produced *fewer* claims than before.

Claim count and evidence quality are different quantities, and this condition treats them as one:

- **"We found nothing"** — 0 claims, confidence 0.0. Iterating is right, and it worked.
- **"We found a little, and it is solid"** — 2 claims, confidence 1.0. Iterating hurt.

This is readable from the code, not only from the single observation: `compute_confidence` already accounts for thinness through its source factor, so a low claim count at high confidence means the question was narrow, not that the evidence was poor.

### 1.3 `min_grounded` has no caller

`agent.py:594` calls `needs_iteration(output, rounds, max_rounds)`. No test passes it either. It is a defaulted parameter nobody supplies, encoding the rule this spec removes.

## 2. Requirements

Confirmed with the user during design:

1. **Fix the trigger, not the steering.** Steering (`gap_query`) is a separate concern with its own evidence and is explicitly out of scope here.
2. **Keep the loop.** The measurement removed the case for deletion: it fires legitimately and rescued one query from zero claims to a real answer.
3. **The behavior change must be visible in the tests**, not absorbed silently.

## 3. Design

### 3.1 The change

```python
def needs_iteration(
    output: ResearchOutput,
    rounds_done: int,
    max_rounds: int,
) -> bool:
    if rounds_done >= max_rounds:
        return False
    if not output.claims:
        return True
    if output.confidence is None or output.confidence < 0.5:
        return True
    return False
```

`min_grounded` is removed from the signature, not merely from the body. Keeping a parameter that nobody passes and that encodes a rule just shown to be wrong leaves a trap for the next reader.

### 3.2 Why the confidence condition stays exactly as it is

`confidence = grounded_fraction × min(1.0, 0.3 + n_sources / 10)`. The source factor already penalises thin evidence: a single-source answer scores 0.4 even with perfect grounding, so it still triggers a round. That is correct — one source is genuinely thin and worth corroborating.

The YaRN case does not fall into that branch because it had enough sources; it had few *claims*. That is precisely the distinction the new trigger draws.

### 3.3 Test changes

One existing test inverts, and that inversion is the point rather than an accident:

```python
test_needs_iteration_true_when_few_claims_and_budget_left
    needs_iteration(n_claims=1, confidence=0.9) is True    # old
```

It encodes the rule being removed. It is rewritten to assert the opposite, with the measured evidence in its docstring.

The other five tests in `tests/test_iteration_pure.py` are unchanged — each was checked individually: low-confidence, strong, budget-exhausted, max-rounds-zero, and confidence-`None` all keep their current results.

Two tests are added, pinning the two observed scenarios by name:

- **PhoGPT shape** — 0 claims, confidence 0.0 → iterates.
- **YaRN shape** — 2 claims, confidence 1.0 → does **not** iterate.

### 3.4 Verification

Re-run `tools/iteration_probe.py` over the same six queries and compare against the recorded baseline at `docs/superpowers/plans/assets/2026-08-25-iteration.json`.

Expected: `queries_that_iterated` falls from 2 to 1. The YaRN query stops iterating; the PhoGPT query still does. Any other change is unexplained and must be investigated before the work is called done.

## 4. What this does not fix

The steering is untouched. Both observed firings used `follow_up_questions[0]` — a question the model generated without having seen any source — and the one that helped succeeded **by luck**: its invented question happened to restate the original query almost exactly. The one that hurt drifted into asking for advice rather than facts.

After this change the PhoGPT case remains the only firing shape, and it still depends on that luck. The next time an invented question drifts the way the YaRN one did, the surviving loop will do harm in the same way.

Stated plainly: this removes the observed instance of harm, not the mechanism that produced it. Fixing the mechanism means giving `gap_query` the signals the system already has — the judge's `missing` field and the claims that failed verification — both of which are currently discarded before the loop can see them. That is a separate piece of work.

## 5. Sample size

Two firings across six queries. Enough to establish that both outcomes occur and to identify the mechanism, and not enough to support a rate. No rate is claimed anywhere in this document.
