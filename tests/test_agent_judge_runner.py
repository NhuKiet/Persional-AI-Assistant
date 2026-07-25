import threading
import time

import backend.app.features.research.agent as agent_mod
from backend.app.features.research.agent import ResearchAgent
from backend.app.features.research.models import SearchResult


def _agent():
    from concurrent.futures import ThreadPoolExecutor
    a = ResearchAgent.__new__(ResearchAgent)
    a._pool = ThreadPoolExecutor(max_workers=2)
    return a


def _src():
    return SearchResult(source="web", title="t", url="u", content="nội dung")


class _Synth:
    def _call(self, prompt):
        return '{"sufficient": true, "missing": ""}'

    def _parse_obj(self, raw):
        import json
        return json.loads(raw)


def test_judge_returns_verdict():
    assert _agent()._run_judge("q", [_src()], _Synth(), None) == (True, None)


def test_judge_returns_none_when_already_cancelled():
    ev = threading.Event()
    ev.set()
    assert _agent()._run_judge("q", [_src()], _Synth(), ev) is None


def test_judge_observes_cancellation_while_in_flight(monkeypatch):
    """Hủy giữa lúc judge đang chạy phải được thấy, không đợi call trả về."""
    ev = threading.Event()

    class SlowSynth(_Synth):
        def _call(self, prompt):
            time.sleep(5)
            return '{"sufficient": true}'

    threading.Timer(0.2, ev.set).start()
    t0 = time.time()
    got = _agent()._run_judge("q", [_src()], SlowSynth(), ev)
    elapsed = time.time() - t0

    assert got is None
    assert elapsed < 2          # không đợi hết 5 giây


def test_judge_timeout_yields_insufficient(monkeypatch):
    monkeypatch.setattr(agent_mod, "_JUDGE_TIMEOUT_SECONDS", 0.3)

    class SlowSynth(_Synth):
        def _call(self, prompt):
            time.sleep(5)
            return '{"sufficient": true}'

    assert _agent()._run_judge("q", [_src()], SlowSynth(), None) == (False, None)
