"""Where the time goes in a streamed answer.

`timed()` wraps a feature's event stream on its way to SSE and notes when
each milestone first shows up, counted from the start of the request:

  first_token      the user sees the answer begin (TTFT)
  source:<name>    a research searcher finished (they run in parallel, so
                   the slowest one is what holds synthesis back)
  synthesizing     research moves from gathering to writing
  first_section    research shows its first section (it sends no tokens)
  sources          PDF retrieval finished
  plan/code/first_run   coding agent milestones
  total            the whole run — recorded only for runs that finished
                   ("done"), so errors don't skew it

Each run is logged on one line; the last WINDOW values per stage are kept
in memory and summarised as p50/p95 at GET /health/latency. The stream
itself passes through untouched.
"""
import logging
import math
import threading
import time
from collections import defaultdict, deque
from collections.abc import AsyncIterator, Callable

logger = logging.getLogger(__name__)

WINDOW = 200

_MARKS = {
    "token": "first_token",
    "synthesizing": "synthesizing",
    # Research answers arrive section by section, not as tokens.
    "section_done": "first_section",
    "sources": "sources",
    "plan": "plan",
    "code": "code",
    "output": "first_run",
}
_TERMINAL = ("done", "error", "cancelled")


def _mark_for(event: dict) -> str | None:
    kind = event.get("type")
    if kind == "source_done":
        return f"source:{event.get('source', '?')}"
    return _MARKS.get(kind)


def _ms(seconds: float) -> int:
    return int(round(seconds * 1000))


def _percentile(sorted_values: list[int], fraction: float) -> int:
    """Nearest-rank percentile."""
    return sorted_values[max(0, math.ceil(fraction * len(sorted_values)) - 1)]


class LatencyStats:
    def __init__(self, window: int = WINDOW):
        self._window = window
        self._lock = threading.Lock()
        self._samples: dict[str, dict[str, deque[int]]] = defaultdict(dict)

    def record(self, feature: str, stage: str, ms: int) -> None:
        with self._lock:
            stages = self._samples[feature]
            stages.setdefault(stage, deque(maxlen=self._window)).append(ms)

    def snapshot(self) -> dict:
        with self._lock:
            copy = {f: {s: list(v) for s, v in stages.items()} for f, stages in self._samples.items()}
        out: dict = {}
        for feature, stages in copy.items():
            out[feature] = {}
            for stage, values in stages.items():
                ordered = sorted(values)
                out[feature][stage] = {
                    "count": len(values),
                    "p50_ms": _percentile(ordered, 0.5),
                    "p95_ms": _percentile(ordered, 0.95),
                    "last_ms": values[-1],
                }
        return out


latency = LatencyStats()


def timed(
    feature: str,
    events: AsyncIterator[dict],
    stats: LatencyStats | None = None,
    clock: Callable[[], float] = time.perf_counter,
) -> AsyncIterator[dict]:
    """Pass `events` through, timing its milestones (see module docstring)."""
    return _timed(feature, events, stats or latency, clock)


async def _timed(feature: str, events: AsyncIterator[dict], stats: LatencyStats, clock) -> AsyncIterator[dict]:
    start = clock()
    marks: dict[str, int] = {}
    outcome = "incomplete"
    try:
        async for event in events:
            mark = _mark_for(event)
            if mark and mark not in marks:
                marks[mark] = _ms(clock() - start)
            if outcome == "incomplete" and event.get("type") in _TERMINAL:
                outcome = event["type"]
            yield event
        if outcome == "incomplete":
            outcome = "done"  # ran to the end without an error (chat sends no "done" event)
    except GeneratorExit:
        if outcome == "incomplete":
            outcome = "disconnected"  # the browser closed the stream
        raise
    except Exception:
        outcome = "exception"
        raise
    finally:
        total = _ms(clock() - start)
        for stage, ms in marks.items():
            stats.record(feature, stage, ms)
        if outcome == "done":
            stats.record(feature, "total", total)
        logger.info(
            "latency feature=%s outcome=%s total_ms=%d %s",
            feature, outcome, total, " ".join(f"{stage}={ms}" for stage, ms in marks.items()),
        )
