"""Is a stored-knowledge answer actually worse than a searched one?

The knowledge gate's tier-2 judge answered "insufficient" on 15 of 16
evaluations across two very different evidence volumes, so reuse has never
fired in production measurement. Whether that strictness is right or wasteful
turns on one question no metric answers: are answers built from stored chunks
actually worse?

This produces both answers for the same query so a person can read them side
by side:

  A — reuse:  synthesize_rag_grounded over the retrieved candidates only.
              Exactly the path the system takes when the judge says "sufficient".
              2 LLM calls, no search.
  B — normal: whatever _run_core actually does today, which in practice means
              top-up: the stored sources merged with a fresh search.

Deliberately does NOT score the two. Scoring would need a metric, and the
reason this question is still open is that no metric can answer it.

Usage:
  PYTHONPATH=. PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe \
      tools/gate_compare.py --out gate.json
"""
from __future__ import annotations

import argparse
import json
import time

# Spans the candidate-count range seen in the store: 1, 2, 3 and 5.
QUERIES = [
    "RAG hoạt động thế nào",
    "Mixture of Experts là gì",
    "So sánh DPO và PPO trong huấn luyện mô hình ngôn ngữ",
    "Cách đánh giá chất lượng hệ thống RAG",
]


def _summarize(out) -> dict:
    """Mechanical facts only. The judgement is the reader's."""
    return {
        "claims": len(out.claims),
        "confidence": out.confidence,
        "sources": len(out.references),
        "summary_short": out.summary_short,
        "summary_medium": out.summary_medium,
        "summary_detailed": out.summary_detailed,
        "key_points": out.key_points,
        "limitations": out.limitations,
        "quotes": [c.quote for c in out.claims],
    }


def reuse_answer(agent, query: str) -> dict:
    """The answer the system would give if the judge said 'sufficient'."""
    from backend.app.features.research import sufficiency
    from backend.app.features.research.knowledge_store import get_store

    t0 = time.time()
    candidates = get_store().retrieve_candidates(query)
    state, fresh = sufficiency.assess(query, candidates)
    if not fresh:
        return {"error": f"no fresh candidates (state={state})", "state": state}

    out = agent.synth.synthesize_rag_grounded(query, fresh)
    row = _summarize(out)
    row["state"] = state
    row["candidates"] = len(fresh)
    row["wall_seconds"] = round(time.time() - t0, 1)
    return row


def normal_answer(agent, query: str) -> dict:
    """Whatever the pipeline does today — in practice, top-up."""
    t0 = time.time()
    core = agent._run_core(query, None, None, None, None)
    decision = None
    out = None
    while True:
        try:
            event = next(core)
        except StopIteration as stop:
            out = stop.value
            break
        if event.get("type") == "knowledge_decision":
            decision = event.get("decision")
    if out is None:
        return {"error": "no output"}
    row = _summarize(out)
    row["decision"] = decision
    row["wall_seconds"] = round(time.time() - t0, 1)
    return row


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    from backend.app.features.research.agent import ResearchAgent

    agent = ResearchAgent()
    rows = []
    for q in QUERIES:
        print(f"→ {q}")
        a = reuse_answer(agent, q)
        print(f"   reuse : claims={a.get('claims')} conf={a.get('confidence')} "
              f"src={a.get('candidates')} {a.get('wall_seconds')}s")
        b = normal_answer(agent, q)
        print(f"   normal: claims={b.get('claims')} conf={b.get('confidence')} "
              f"src={b.get('sources')} decision={b.get('decision')} {b.get('wall_seconds')}s")
        rows.append({"query": q, "reuse": a, "normal": b})

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=1)
    print("written:", args.out)


if __name__ == "__main__":
    main()
