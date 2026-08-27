"""Bounded-iteration logic cho Research — quyết định lặp và sinh query bù.

Thuần, deterministic, không I/O. Vòng lặp thực tế nằm ở agent.py.
"""
from backend.app.features.research.models import ResearchOutput


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

    The zero-claims branch is defence in depth rather than extra coverage:
    compute_confidence already returns 0.0 for an empty claim list, so every
    state this pipeline actually reaches with no claims also has a confidence
    the branch below would catch. It stays because a future change to
    compute_confidence should not silently disable the loop.
    """
    if rounds_done >= max_rounds:
        return False
    if not output.claims:
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
