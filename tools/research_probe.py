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
