# Iteration Trigger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a supplementary research round fire only when the evidence is genuinely weak, not merely when few claims were extracted.

**Architecture:** One pure function changes. `needs_iteration` stops counting claims and asks instead whether there is any evidence at all and whether confidence is low. `min_grounded` leaves the signature entirely. Nothing else in the loop, the steering, or the agent changes.

**Tech Stack:** Python 3.11+, pytest 8.3.4.

**Spec:** `docs/superpowers/specs/2026-08-26-iteration-trigger-design.md`

## Global Constraints

- Python interpreter for every command: `.venv/Scripts/python.exe` (Windows, Git Bash shell). Prefix live-run commands with `PYTHONPATH=. PYTHONIOENCODING=utf-8` — without the second, Vietnamese output crashes the Windows console encoder.
- Test root is `tests/` (`pyproject.toml` sets `testpaths = ["tests"]`). Backend code lives under `backend/app/`.
- Suite before this work: **564 passed, 17 skipped, 0 failed**.
- `iteration.py` is a **pure module** — no I/O, no network, no imports of embeddings, LLM clients, or the capability registry. It must stay that way.
- **Exactly one existing test inverts**, and that inversion is the deliverable, not an accident: `test_needs_iteration_true_when_few_claims_and_budget_left`. Any *other* test that needs changing is evidence something unintended broke — investigate before editing it.
- `gap_query` is **not** touched. Steering is a separate concern with its own evidence, explicitly out of scope.
- `RESEARCH_MAX_ITERATIONS`, the `while` loop in `agent.py:594`, and `_iteration_step` are **not** touched.
- The confidence branch keeps its exact current form: `if output.confidence is None or output.confidence < 0.5`.
- Commit after the task. Never use `--no-verify`. Branch is `main` — work directly on it, do not push.

---

## File Structure

**Modified:**
- `backend/app/features/research/iteration.py` — `needs_iteration` loses the `min_grounded` parameter and the claim-count rule.
- `tests/test_iteration_pure.py` — one test inverted, two added.

No files are created. No other module imports `needs_iteration` except `agent.py`, which calls it positionally with three arguments and is therefore unaffected by dropping a fourth defaulted one.

---

### Task 1: Trigger on weak evidence, not on claim count

**Files:**
- Modify: `backend/app/features/research/iteration.py`
- Test: `tests/test_iteration_pure.py`

**Interfaces:**
- Produces: `needs_iteration(output: ResearchOutput, rounds_done: int, max_rounds: int) -> bool` — three parameters, no `min_grounded`.
- `gap_query(query: str, output: ResearchOutput) -> str | None` is unchanged and keeps every current test.

**Why this change.** Measured on six deliberately hard queries (`tools/iteration_probe.py`, baseline at `docs/superpowers/plans/assets/2026-08-25-iteration.json`), the loop fired twice. One firing helped: 0 claims and confidence 0.0 became 1 claim at confidence 1.0. The other hurt: **2 claims at confidence 1.0** tripped the `len(claims) < 3` rule, fetched one more source, and the re-synthesis came back with *fewer* claims than before. Claim count and evidence quality are different quantities, and `compute_confidence` already accounts for thinness through its source factor — so few claims at high confidence means the question was narrow, not that the evidence was poor.

- [ ] **Step 1: Rewrite the test that encodes the old rule**

In `tests/test_iteration_pure.py`, replace this test:

```python
def test_needs_iteration_true_when_few_claims_and_budget_left():
    assert needs_iteration(_out(n_claims=1, confidence=0.9), rounds_done=0, max_rounds=1) is True
```

with its inverse, which is the behavior change this task delivers:

```python
def test_no_iteration_for_a_narrow_but_well_grounded_answer():
    """Few claims at high confidence means the question was narrow, not that
    the evidence was poor. Measured: a query with 2 claims at confidence 1.0
    tripped the old `len(claims) < 3` rule, and the extra round came back with
    fewer claims than it started with."""
    assert needs_iteration(_out(n_claims=1, confidence=0.9), rounds_done=0, max_rounds=1) is False
```

- [ ] **Step 2: Add the two observed scenarios as tests**

Append to `tests/test_iteration_pure.py`:

```python
def test_iterates_when_nothing_was_found():
    """The PhoGPT-4B/VMLU shape from the probe: zero claims and zero
    confidence. This firing rescued the query — 0 claims became 1 at
    confidence 1.0 — and is the case the loop exists for."""
    assert needs_iteration(_out(n_claims=0, confidence=0.0), rounds_done=0, max_rounds=1) is True


def test_does_not_iterate_on_the_shape_that_measurably_hurt():
    """The YaRN shape from the probe: 2 claims, confidence 1.0. Under the old
    rule this fired and made the answer worse."""
    assert needs_iteration(_out(n_claims=2, confidence=1.0), rounds_done=0, max_rounds=1) is False
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_iteration_pure.py -v`

Expected: **two** failures — `test_no_iteration_for_a_narrow_but_well_grounded_answer` and `test_does_not_iterate_on_the_shape_that_measurably_hurt`, both because the current `len(claims) < 3` rule returns `True`. `test_iterates_when_nothing_was_found` should already **pass**, because zero claims trips the old rule too; that is expected and not a problem — it pins behavior that must survive the change.

- [ ] **Step 4: Change the trigger**

In `backend/app/features/research/iteration.py`, replace `needs_iteration` entirely:

```python
def needs_iteration(
    output: ResearchOutput,
    rounds_done: int,
    max_rounds: int,
) -> bool:
    """Whether a supplementary research round is worth its cost.

    Deliberately does NOT count claims. Measured on six hard queries: a result
    with 2 claims at confidence 1.0 tripped the old `len(claims) < 3` rule, and
    the extra round returned fewer claims than it started with. Few claims at
    high confidence means the question was narrow, not that the evidence was
    thin — and compute_confidence already accounts for thinness through its
    source factor, so a single-source answer still scores 0.4 and still
    triggers a round here.
    """
    if rounds_done >= max_rounds:
        return False
    if not output.claims:
        return True
    if output.confidence is None or output.confidence < 0.5:  # deliberate: missing confidence counts as weak, iterate up to cap
        return True
    return False
```

`min_grounded` is removed from the signature, not merely from the body. Nothing passes it — `agent.py:594` calls `needs_iteration(output, rounds, max_rounds)` and no test supplies it — so keeping a defaulted parameter that encodes the rule just removed would leave a trap for the next reader.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_iteration_pure.py -v`

Expected: PASS, 14 tests.

Confirm specifically that these five keep their original results, none of which should have changed:

- `test_needs_iteration_true_when_low_confidence` (5 claims, 0.3) → True
- `test_needs_iteration_false_when_strong` (5 claims, 0.8) → False
- `test_needs_iteration_false_when_budget_exhausted` (0 claims, rounds_done=1) → False
- `test_needs_iteration_false_when_max_rounds_zero` (0 claims, max_rounds=0) → False
- `test_needs_iteration_true_when_confidence_none_and_claims_strong` (5 claims, None) → True

If any of those five fails, stop: the change did more than intended.

- [ ] **Step 6: Run the full suite**

Run: `.venv/Scripts/python.exe -m pytest tests -q`

Expected: **566 passed, 17 skipped, 0 failed** — 564 before, plus the two added tests. The inverted test is a replacement, not an addition.

- [ ] **Step 7: Confirm the pure module stayed pure**

Run:

```bash
grep -nE "^(import|from)" backend/app/features/research/iteration.py
```

Expected: exactly one import, `from backend.app.features.research.models import ResearchOutput`. Any import of `capabilities`, `embeddings`, `llm`, or anything doing I/O means the module lost its purity and the change went wrong.

- [ ] **Step 8: Commit**

```bash
git add backend/app/features/research/iteration.py tests/test_iteration_pure.py
git commit -m "fix(research): iterate on weak evidence, not on a low claim count"
```

---

### Task 2: Verify against the recorded baseline

The unit tests prove the rule. This proves the rule changes the real pipeline the way the measurement predicted, and nothing else.

**Files:**
- Create: `docs/superpowers/plans/assets/2026-08-26-iteration-after.json`

**Interfaces:**
- Consumes: `needs_iteration` from Task 1.
- Produces: nothing other code depends on.

- [ ] **Step 1: Re-run the probe over the same six queries**

```bash
PYTHONPATH=. PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe \
    tools/iteration_probe.py --out docs/superpowers/plans/assets/2026-08-26-iteration-after.json
```

This makes six live research runs and takes several minutes. Run it in the foreground of a long-lived shell — output is also printed per query as it goes.

- [ ] **Step 2: Compare against the baseline**

```bash
PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe -c "
import json
b = json.load(open('docs/superpowers/plans/assets/2026-08-25-iteration.json', encoding='utf-8'))
a = json.load(open('docs/superpowers/plans/assets/2026-08-26-iteration-after.json', encoding='utf-8'))
print('%-52s %6s %6s' % ('query', 'before', 'after'))
for rb, ra in zip(b['rows'], a['rows']):
    print('%-52s %6d %6d' % (rb['query'][:52], len(rb['iterations']), len(ra['iterations'])))
print()
for k in b['summary']:
    print('%-32s %10s -> %10s' % (k, b['summary'][k], a['summary'].get(k)))
"
```

**Expected:** `queries_that_iterated` falls from 2 to 1. The YaRN query (`YaRN RoPE scaling dùng hệ số alpha và beta…`) stops iterating. The PhoGPT query (`PhoGPT-4B đạt bao nhiêu điểm…`) still iterates.

- [ ] **Step 3: Judge the result against a criterion fixed in advance**

- **YaRN stops, PhoGPT still fires** — the change did exactly what the measurement predicted. Proceed.
- **PhoGPT also stops firing** — the change went too far. Its claims were 0 and confidence 0.0, which `not output.claims` must still catch. Investigate before proceeding; do not adjust the threshold to make the number look right.
- **A query that did not iterate before now does** — unexplained. Investigate.
- **The counts match but the claim/confidence figures moved a lot** — that is run-to-run variation in live search, not this change. Note it and say so plainly rather than attributing it to the fix.

Live search varies between runs, so a query that sits near a threshold may land differently for reasons unrelated to this work. Report what the per-round records show rather than only the summary — the baseline's `mean_claims_delta` was `0.0`, the average of `-1` and `+1`, and that figure concealed the entire finding.

- [ ] **Step 4: Record the outcome in the spec**

Append a `## 6. Result` section to `docs/superpowers/specs/2026-08-26-iteration-trigger-design.md` with the before/after table and, if the criterion in Step 3 was not met, what actually happened instead.

- [ ] **Step 5: Commit**

```bash
git add -f docs/superpowers/plans/assets/2026-08-26-iteration-after.json docs/superpowers/specs/2026-08-26-iteration-trigger-design.md
git commit -m "chore(research): record the iteration-trigger result against baseline"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §3.1 the change, `min_grounded` removed from the signature | 1, Step 4 |
| §3.2 confidence condition kept exactly as-is | 1, Step 4 (verbatim, including its trailing comment) |
| §3.3 one test inverted, five unchanged, two added | 1, Steps 1–2, verified in Step 5 |
| §3.4 verification against the recorded baseline | 2 |
| §4 what this does not fix (steering) | no task, by design — `gap_query` is untouched, enforced by Global Constraints |
| §5 sample size | documentation only |

No spec requirement is unassigned.

**Placeholder scan:** no TBD, TODO, "similar to Task N", or step lacking its code.

**Type consistency:** `needs_iteration(output, rounds_done, max_rounds)` has the same three-parameter signature in the Interfaces block, Step 4's implementation, and every test in Steps 1–2. `gap_query`'s signature is stated only to record that it does not change.

**One thing worth flagging to whoever executes this:** Step 3 of Task 1 expects `test_iterates_when_nothing_was_found` to pass *before* the implementation. That is not a broken TDD cycle — the test pins behavior that must survive the change, and a test which passes both before and after is the correct shape for a regression guard. The two tests that must fail first are named explicitly.
