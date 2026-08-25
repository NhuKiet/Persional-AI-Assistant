# Subagent-Driven Development Progress

Plan: `docs/superpowers/plans/2026-07-28-news-liquid-bars.md`

Audit: complete (no Critical; four Important fixes required before adopting WIP)

- Move the loading live region outside the Refresh button.
- Make the loading test prove the initial request settled and Refresh started a second request.
- Add the planned News liquid-bars CSS contract test.
- Disable residual highlight transitions under reduced motion.

Task 1: complete (commits eefa70f..ca11924, review clean)

Tasks 2–3: review fixes required after commit 6b06877

- Enforce that every refraction `filter:` declaration belongs only to allowed
  decorative `::after` selectors.
- Contract the 1099 px topic gap and padding reduction.
- Prove the fallback cannot reset/remove the active gradient.
- Replace magic `.news-tab` occurrence selection with a standalone-selector
  helper.

Tasks 2–3: complete (commits ca11924..7c95746, review clean)

Task 4: complete (commits 7c95746..7b4a970, review approved)

Minor carried to final review:

- Browser metrics are recorded in the ignored report, but no screenshot artifact
  was saved; runtime reduced-motion emulation was unavailable. CSS contracts
  cover reduced motion, and mobile focus was measured on Robotics plus the
  row's first/last padding geometry.

---

Plan: `docs/superpowers/plans/2026-07-29-news-glass-controls.md`

Execution: approved in the existing dirty workspace; task agents may modify
only the files listed in their task brief.

Baseline: 234 frontend tests pass; typecheck and production build pass.

Task 1: complete (commits 26cb58e..4e3faf4, review clean)

Task 2: complete (commits 4e3faf4..c815f25, review approved)

Minor carried to final review:

- `GlassControlPanel.test.tsx` describes a clamped change but uses in-range
  value 86; pure clamping boundaries are covered in Task 1.

Task 3: complete (commits 3ab07f0..41b940c, review clean)

Task 4: complete (commits 41b940c..b9c7599, review clean after fix)

Task 5: complete (verification report approved; 36 files / 244 tests,
typecheck, and build pass; live browser unavailable)

Final review: clean at 8e25490 (no Critical, Important, or Minor findings)

Final verification: 36 files / 244 tests pass sequentially; typecheck and
production build pass. An earlier parallel run caused one unrelated Coding
test timeout; the test passed alone (4/4) and in the sequential full suite.

---

Plan: `docs/superpowers/plans/2026-07-29-news-directional-micro-glint.md`

Execution: approved in the existing dirty workspace because the requested
shine change must integrate with the user's uncommitted News/Falling Leaves
work. Task agents may modify only the files listed in their task brief.

Baseline: 36 frontend test files / 247 tests pass. Existing jsdom Canvas and
React Router warnings remain in the output from unrelated uncommitted work.

Task 1: complete (commits ba92c8a..83b8148, review clean)

Task 1 reviewer note resolved by controller: runtime highlight placement and
dispersion containment are intentionally owned by Task 2, not the pure mapper
change reviewed in Task 1.

Task 2: complete (uncommitted overlay on 83b8148, snapshot diff review clean)

Task 2 reviewer note resolved: browser automation was blocked by localhost
policy, so stronger scoped static assertions now prove bounded width, no
full-width or edge anchoring, no border perimeter, rotation, and asymmetry.

Task 3: complete (36 files / 249 tests, typecheck, and production build pass;
verification review approved after focused contract fix)

Final review: approved after fixing the stale CSS fallback from 42.48% to
14.12% and adding scoped regression coverage.

Final verification: typecheck passes; 36 frontend test files / 250 tests pass;
production build passes (147 modules transformed). The intended CSS and
contract-test hunks remain unstaged/uncommitted to preserve unrelated dirty
News work. Dev server is running at `http://127.0.0.1:5173/news`.

---

Plan: `docs/superpowers/plans/2026-07-30-ai-factory-atom-background-shockwave-smoothing.md`

Execution: user selected subagent-driven development. The standalone Atom
artifact lives outside Git, so isolation uses a dedicated writable working
copy, recovery backup, per-task no-index diff packages, and SHA-256 delivery
verification instead of a Git worktree or implementation commits.

Task 1: complete (standalone contract snapshot; review clean). Controller
confirmed the required RED state: exit 1 with all 22 contract checks failing
against the pre-implementation target.

Task 2: complete (standalone working snapshot
`C45C843632972EF067F4351A7C08852822154C2711A0E2E17E3F83CECA3344E1`;
review clean). Controller confirmed focused contract PASS, inline-module syntax
PASS, and the user's target remains unchanged.

Task 3: complete (delivery and recovery verification; review approved with no
Critical or Important findings). The delivered target, verified working copy,
and HTTP payload share SHA-256
`C45C843632972EF067F4351A7C08852822154C2711A0E2E17E3F83CECA3344E1`.
The long-path-safe recovery backup matches the original target SHA-256
`19508FA556A98C37995ABE4FBB013838478A81CDB060AD58D30384616997948C`.

Minor carried to final review:

- Preserve the exact long-path recovery command and capture timestamps in
  future delivery reports; current hash and full-cycle evidence is sufficient.

Final review: Ready (no Critical or Important findings).

Final-review minors:

- The dormant-ring skip condition is unreachable with the approved overlap
  constants, so benchmark or retune it in a future performance pass.
- Add a direct reduced-motion browser assertion in future regression coverage.
- Use long-path-safe, terminating, hash-verified backup handling before target
  replacement in future deliveries.

Final verification: focused contract and inline-module syntax pass; working,
target, and HTTP payload hashes match; HTTP returns 200; the recovery backup
matches the original hash; cache-busted browser runtime is WebGL-ready with
fallback hidden and zero logs.

---

Plan: `docs/superpowers/plans/2026-08-18-research-grounding-and-model-fit.md`

Execution: user selected subagent-driven development on branch `develop`.

Pre-flight: one plan defect fixed before dispatch — Task 4's
`test_batch_fallback_does_not_fire_when_quotes_work` used 2 claims, so the
min-claims guard short-circuited it and the 30% threshold was untested.
Changed to 4 claims / 2 grounded (user approved: "Sửa test, plan nhượng").

Baseline before execution: 449 passed, 4 failed (pre-existing
`tests/test_news_fetcher.py`), 17 skipped.

Task 1: HALTED AT GATE (commits 74185c5..HEAD).

The first probe run was invalid — two instrumentation bugs (yield-from
swallowing the return value; extract_claims patched on the wrong binding).
Fixed and re-run.

Corrected baseline FALSIFIES spec section 1.1:
  mean_grounded_fraction 0.396 (predicted ~0)
  mean_confidence        0.607 (predicted ~0)
  total_iteration_rounds 6 of 8 (predicted 8 of 8)
  mean_ctx_chars         7203  (predicted ~7000 — CONFIRMED)
  charts_produced        1 of 8
  comparison_rows        4 on all 8 queries, only 1 had compare intent

Per the spec's own falsification criterion, execution is stopped. Tasks 2-5
and 9 (grounding, iteration steering) rest on the falsified premise. Tasks
6-8, 10, 11 (capability table, budget, structured output, rerank, removals)
are independently supported by the baseline and by direct code reading.

Environment: Weaviate returned 503 throughout; the knowledge-gate path was
never exercised. Baseline measures the live-search path only.

Awaiting user decision on how to proceed.
Revision 2 (393fd90): spec sections 3 and 7 withdrawn, plan cut from 12 tasks
to 6. Revision 1 archived at
docs/superpowers/plans/2026-08-18-research-grounding-and-model-fit.rev1-superseded.md
User decision: run the verified parts, defer grounding.

Revision 2 task list: 1 capability table, 2 context budget, 3 structured
output, 4 rerank unification, 5 removals + comparison gating, 6 re-measure.

Task 1: complete (commits 393fd90..49a6faa, review clean — spec ✅, quality approved)

Minor carried to final review:
- `capabilities_for` does not validate `provider` the way `get_llm` does; an
  unrecognized provider string resolves to the openai default instead of
  raising. No caller passes one today.

Task 2: complete (commits 49a6faa..9a47f8a, review clean — spec ✅, quality approved)
Suite: 460 passed, 4 pre-existing failures, 17 skipped.

Minors carried to final review:
- synthesizer.py module docstring still says "Context is truncated
  aggressively — local models degrade badly on long contexts", stale now that
  the budget scales with the model.
- _make_comparison_table has no _ctx-style hard cap, so per_source_chars x
  num_sources can exceed max_chars for pathologically small windows (needs
  context_window < ~1714 to bite; llama3 is 8192).

Task 3: complete (commits 9a47f8a..60a9d86, review clean — spec ✅, quality
approved, no findings at any severity). Suite: 467 passed, 4 pre-existing
failures, 17 skipped. Live check confirmed structured: True against
gpt-5.6-luna with grounding behaviour unchanged.

Note: _make_summaries issues a second LLM call when the structured attempt
returns None. Brief-specified and intended; costs one extra round-trip only
on structured-output failure.

Task 4: complete (commits 60a9d86..d700ed6, review approved — spec ✅).
Suite: 474 passed, 4 pre-existing failures, 17 skipped.
Three self-reported deviations all adjudicated acceptable: float addition
reorder (no weight changed), three extra files touched as mechanical
follow-ons of deleting _get_reranker, eight tests rewritten with coverage
intact.

Minors carried to final review:
- tests/test_reranker.py asserts float equality exactly (`== [1.0]`) and now
  depends on incidental FP association order. Swap for abs(...) < 1e-9 like
  its sibling tests.
- The length-mismatch fallback in rerank_results is new defensive code with
  no test exercising it.

Task 5: complete (commits d700ed6..f352d43, review approved — spec ✅).
Suite: 475 passed, 4 pre-existing failures, 17 skipped. Frontend build passes.
Extra in-file cleanup verified genuinely dead: os/FileResponse in router.py,
hashlib in synthesizer.py, frame_untrusted in prompts.py.

Plan-mandated finding escalated to user: has_compare_intent used `kw in q`
with a bare "vs", matching substrings ("devs", "revs"). User chose to fix
with word-boundary matching for short tokens. Task 5a follows.

Controller correction: the Task 6 expectation table said comparison would
drop to 1 of 8 queries. Recounting the probe set, TWO queries carry compare
intent — "So sánh DPO và PPO" and "...khác GAN ở điểm nào". Expected after
is 2 of 8.

Task 5a: complete (commits f416fcc..5c8593a, review approved — spec ✅).
Word-boundary matching for short compare keywords. Controller verified the
suite directly: 4 failed (all pre-existing test_news_fetcher.py), 477 passed,
17 skipped. The implementer's report of "5 failed" was a flaky test that
passed on re-run, not a regression.

Minors carried to final review:
- re.IGNORECASE in _COMPARE_WORD_RE is redundant (q is already lowercased).
- test_short_keyword_does_not_match_inside_a_word bundles three assertions.

Task 6 (re-measure) started by the controller directly, not a subagent: an
earlier subagent backgrounded the probe and the process died when its turn
ended, costing ~30 minutes of apparent progress.

Task 7: complete (commits 5c8593a..870f83e, review clean — spec OK, quality
approved). Chart now requires a verbatim source quote containing at least two
of the plotted numbers. Suite: 486 passed, 4 failed (pre-existing), 17 skipped.

Task 7 minors carried to final review:
- _number_forms uses f"{value:g}", which goes scientific above ~1e6, so very
  large plotted values would not match a verbatim quote.
- The 2-of-N number match is a set intersection over the whole quote, not tied
  to label/value pairing; unrelated numbers in the quote can satisfy it.

Task 8: complete (commits 870f83e..HEAD). Controlled A/B, both arms back to
back, source conditions comparable (semantic 106 vs 102 failures, weaviate 23
vs 20, ctx 35978 vs 36045 chars).

  high: grounded 0.287, confidence 0.506, 7 iteration rounds, 86.4s
  none: grounded 0.442, confidence 0.543, 4 iteration rounds, 81.6s

Reasoning effort attributed as the cause of the Task 6 drift, NOT the source
mix. User decision: drop the effort parameter from claim extraction entirely
(model default, as before Task 3); keep RESEARCH_CLAIM_EFFORT for future
experiments. Spec section 13 records the full result including what the
measurement does and does not establish.

Environment findings recorded in spec 13.4, not fixed this round (user
decision): BGE reranker never loads (XLMRobertaTokenizer/FlagEmbedding version
conflict) and no COHERE_API_KEY, so cross-encoder reranking has never run
here; Weaviate 503 throughout, so the knowledge-gate path was never measured.

Suite after Task 8: 486 passed, 4 failed (pre-existing), 17 skipped.

Final whole-branch review (opus, b7e49a7..5791bc4): no Critical. Two Important,
both fixed in 5a3a5df:
- Session restore rendered fabricated compare rows from pre-branch stored
  payloads, because both frontend guards were removed while only new runs go
  through the backend gate. Now filtered by the deleted fallback's signature.
- _make_key_points returned unconditionally on the structured branch, so a
  result whose points were all filtered out skipped the text fallback and the
  panel vanished.

Controller correction to the review: it flagged knowledge_store._rerank as
missing a rerank length-mismatch guard. It has one (knowledge_store.py:208).
No change made.

Final-review minors, not fixed (all fail safe, reviewer concurred):
- _number_forms f"{value:g}" goes scientific above ~1e6; only ever rejects a
  valid chart, never accepts an invalid one.
- Chart 2-of-N number match is a set intersection over the whole quote; still
  requires the quote verbatim in context.
- _make_comparison_table caps per-source but not against budget.max_chars;
  safe while callers pass <=15 sources.
- llm.py supports_temperature is stored and tested but consumed nowhere.
- has_compare_intent matches bare "between"; one wasted call, no wrong output.
- re.IGNORECASE redundant in _COMPARE_WORD_RE; bundled asserts in one test.

Final state: 487 passed, 4 failed (pre-existing test_news_fetcher.py), 17
skipped. Frontend build passes; 5 pre-existing landing-page smoke failures
unrelated to this branch.

BRANCH COMPLETE — awaiting user decision on merge.
