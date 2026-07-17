"""Bounded-iteration logic cho Research — quyết định lặp và sinh query bù.

Thuần, deterministic, không I/O. Vòng lặp thực tế nằm ở agent.py.
"""
from backend.app.features.research.models import ResearchOutput


def needs_iteration(
    output: ResearchOutput,
    rounds_done: int,
    max_rounds: int,
    min_grounded: int = 3,
) -> bool:
    if rounds_done >= max_rounds:
        return False
    if len(output.claims) < min_grounded:
        return True
    if output.confidence is None or output.confidence < 0.5:  # deliberate: missing confidence counts as weak, iterate up to cap
        return True
    return False


def gap_query(query: str, output: ResearchOutput) -> str | None:
    if output.follow_up_questions:
        fq = output.follow_up_questions[0].strip()
        if fq:
            return fq[:200]
    q = query.strip()
    if not q:
        return None
    return f"{q} evidence details"[:200]
