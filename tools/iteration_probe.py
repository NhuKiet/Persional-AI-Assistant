"""Does the bounded-iteration loop ever earn its cost?

Two questions, and the second is the one that decides:

  1. Does the loop fire for a legitimate reason — genuinely thin evidence —
     rather than because something upstream was broken? Before the grounding
     repair it fired on 6 of 8 queries, but every one of those was caused by
     claims being falsely empty, so we have never observed a legitimate firing.
  2. When it fires, does the extra round actually improve the answer? If a
     top-up search plus a full re-synthesis leaves claims and confidence where
     they were, the loop is waste no matter how well it is steered.

Deliberately uses queries chosen to produce thin evidence: very specific
numbers, version-pinned details, and niche Vietnamese topics. The standard
probe set is too easy to ever trigger the loop.

Usage:
  PYTHONPATH=. PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe \
      tools/iteration_probe.py --out iteration.json
"""
from __future__ import annotations

import argparse
import json
import time

# Chosen to be hard: pinned versions, exact figures, and niche Vietnamese
# subjects — the shapes most likely to return few or shallow sources.
HARD_QUERIES = [
    "Kiến trúc Mamba-2 khác Mamba-1 ở chỗ nào về cơ chế SSD",
    "YaRN RoPE scaling dùng hệ số alpha và beta bao nhiêu cho ngữ cảnh 128k",
    "PhoGPT-4B đạt bao nhiêu điểm trên benchmark VMLU tiếng Việt",
    "Nên đặt ef_construction bao nhiêu cho HNSW của Weaviate trên máy 8GB RAM",
    "So sánh tốc độ inference Qwen3-0.6B và Gemma3-270M trên CPU ARM",
    "Cơ chế speculative decoding trong vLLM phiên bản 0.9 hoạt động thế nào",
]


def _instrument(rounds_log: list):
    """Record every iteration decision and its before/after effect.

    Returns a restore callable. Patches both the source module and the name
    agent.py bound at import time — patching only the former leaves the call
    site pointing at the original.
    """
    from backend.app.features.research import agent as agent_mod
    from backend.app.features.research import iteration as iter_mod

    orig_needs = iter_mod.needs_iteration
    orig_gap = iter_mod.gap_query
    orig_step = agent_mod.ResearchAgent._iteration_step

    state = {"pending": None}

    def needs_iteration(output, rounds_done, max_rounds):
        verdict = orig_needs(output, rounds_done, max_rounds)
        if verdict:
            # Which condition fired. Claim count is no longer a trigger — the
            # probe recorded a firing at 2 claims and confidence 1.0 that made
            # the answer worse, and that rule is gone.
            state["pending"] = {
                "round": rounds_done + 1,
                "trigger_no_claims": not output.claims,
                "trigger_low_confidence": (
                    output.confidence is None or output.confidence < 0.5
                ),
                "claims_before": len(output.claims),
                "confidence_before": output.confidence,
            }
        return verdict

    def gap_query(query, output):
        gq = orig_gap(query, output)
        if state["pending"] is not None:
            state["pending"]["gap_query"] = gq
            # Derived from the returned value, not recomputed: gap_query falls
            # back to evidence framing when the first follow-up is blank, and a
            # second independent computation here could disagree with the
            # decision it claims to be recording.
            first = (output.follow_up_questions or [""])[0].strip()[:200]
            state["pending"]["gap_came_from_follow_up"] = bool(gq and first and gq == first)
        return gq

    def _iteration_step(self, query, sources, output, synth):
        result = orig_step(self, query, sources, output, synth)
        entry = state["pending"] or {}
        if result is None:
            entry["outcome"] = "step_returned_none"
        else:
            _, new_output, newly = result
            entry["outcome"] = "completed"
            entry["claims_after"] = len(new_output.claims)
            entry["confidence_after"] = new_output.confidence
            entry["new_sources_fetched"] = len(newly)
            entry["claims_delta"] = len(new_output.claims) - entry.get("claims_before", 0)
            before = entry.get("confidence_before") or 0.0
            entry["confidence_delta"] = round((new_output.confidence or 0.0) - before, 3)
        rounds_log.append(entry)
        state["pending"] = None
        return result

    iter_mod.needs_iteration = needs_iteration
    iter_mod.gap_query = gap_query
    agent_mod.needs_iteration = needs_iteration
    agent_mod.gap_query = gap_query
    agent_mod.ResearchAgent._iteration_step = _iteration_step

    def restore():
        iter_mod.needs_iteration = orig_needs
        iter_mod.gap_query = orig_gap
        agent_mod.needs_iteration = orig_needs
        agent_mod.gap_query = orig_gap
        agent_mod.ResearchAgent._iteration_step = orig_step

    return restore


def run_one(agent, query: str) -> dict:
    rounds_log: list = []
    restore = _instrument(rounds_log)
    t0 = time.time()
    output = None
    error = None
    try:
        core = agent._run_core(query, None, None, None, None)
        while True:
            try:
                next(core)
            except StopIteration as stop:
                output = stop.value
                break
    except Exception as e:  # noqa: BLE001 — a probe reports, it does not crash
        error = f"{type(e).__name__}: {e}"
    finally:
        restore()

    row = {
        "query": query,
        "error": error,
        "wall_seconds": round(time.time() - t0, 1),
        "iterations": rounds_log,
    }
    if output is not None:
        row["final_claims"] = len(output.claims)
        row["final_confidence"] = output.confidence
        row["sources"] = len(output.references)
    return row


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    from backend.app.features.research.agent import ResearchAgent

    agent = ResearchAgent()
    rows = []
    for q in HARD_QUERIES:
        print(f"→ {q}")
        row = run_one(agent, q)
        rows.append(row)
        fired = len(row["iterations"])
        print(f"   fired={fired}  claims={row.get('final_claims')}  "
              f"conf={row.get('final_confidence')}  {row['wall_seconds']}s")
        for it in row["iterations"]:
            print(f"     round {it.get('round')}: "
                  f"claims {it.get('claims_before')}->{it.get('claims_after')} "
                  f"conf {it.get('confidence_before')}->{it.get('confidence_after')} "
                  f"| gap={str(it.get('gap_query'))[:70]!r}")

    fired_rounds = [it for r in rows for it in r["iterations"]]
    completed = [it for it in fired_rounds if it.get("outcome") == "completed"]
    improved = [it for it in completed
                if it.get("claims_delta", 0) > 0 or it.get("confidence_delta", 0) > 0]

    summary = {
        "queries": len(rows),
        "errors": sum(1 for r in rows if r.get("error")),
        "queries_that_iterated": sum(1 for r in rows if r["iterations"]),
        "rounds_fired": len(fired_rounds),
        "rounds_completed": len(completed),
        "rounds_that_improved_anything": len(improved),
        "mean_claims_delta": (
            round(sum(it.get("claims_delta", 0) for it in completed) / len(completed), 2)
            if completed else None
        ),
        "mean_confidence_delta": (
            round(sum(it.get("confidence_delta", 0) for it in completed) / len(completed), 3)
            if completed else None
        ),
        "gap_from_follow_up": sum(
            1 for it in fired_rounds if it.get("gap_came_from_follow_up")
        ),
    }
    print("\nSUMMARY:", json.dumps(summary, ensure_ascii=False, indent=2))
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"summary": summary, "rows": rows}, f, ensure_ascii=False, indent=1)
    print("written:", args.out)


if __name__ == "__main__":
    main()
