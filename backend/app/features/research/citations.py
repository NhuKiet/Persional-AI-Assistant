"""Inline `[n]` citations in research summaries.

The synthesizer shows the model its sources numbered `[1] … [n]` in the order
`references` is built, so `[k]` in a summary means `references[k - 1]`. The
model can still cite a number that isn't there; those markers are removed
rather than shown as links to nothing.
"""
import re

# A run of adjacent markers — "[2]" or "[1][3]" — with the spaces before it.
# Not preceded by a word character (`a[2]` is code, not a citation) and not
# followed by "(" (`[2](https://…)` is a markdown link).
_RUN = re.compile(r"([ \t]*)(?<![\w])((?:\[\d{1,3}\])+)(?!\()")
_NUMBER = re.compile(r"\[(\d{1,3})\]")


def strip_invalid_citations(text: str, n_sources: int) -> str:
    """Drop markers outside 1..n_sources; a run left empty takes its leading
    space with it, so "B [7]." becomes "B."."""
    def fix(match: re.Match) -> str:
        space, run = match.group(1), match.group(2)
        kept = [m for m in _NUMBER.findall(run) if 1 <= int(m) <= n_sources]
        return f"{space}{''.join(f'[{k}]' for k in kept)}" if kept else ""

    return _RUN.sub(fix, text)


def remove_citations(text: str) -> str:
    """For text derived from a cited answer but shown without its sources
    (key points and follow-up questions split out of a RAG answer)."""
    return _RUN.sub("", text)
