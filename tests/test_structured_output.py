# tests/test_structured_output.py
from backend.app.core.llm import ModelCapabilities
from backend.app.features.research.models import ResearchOutput
from backend.app.features.research.output_schemas import KeyPoints, SummaryShortMedium
from backend.app.features.research.synthesizer import Synthesizer


class _FakeStructured:
    def __init__(self, result):
        self._result = result

    def invoke(self, prompt):
        if isinstance(self._result, Exception):
            raise self._result
        return self._result


class _FakeLLM:
    def __init__(self, structured_result=None, text="SUMMARY: s\nOVERVIEW: m"):
        self._structured = structured_result
        self._text = text
        self.bind_calls = []

    def bind(self, **kwargs):
        self.bind_calls.append(kwargs)
        return self

    def with_structured_output(self, schema):
        return _FakeStructured(self._structured)

    def invoke(self, prompt):
        text = self._text

        class _R:
            content = text
        return _R()


def _synth(llm, caps):
    return Synthesizer(llm=llm, capabilities=caps)


_STRUCTURED_CAPS = ModelCapabilities(200_000, True, True, ("low", "medium", "high"))
_PLAIN_CAPS      = ModelCapabilities(8192, False, True)


def test_structured_path_returns_parsed_model():
    want = SummaryShortMedium(short="s", medium="m")
    s = _synth(_FakeLLM(structured_result=want), _STRUCTURED_CAPS)
    assert s._call_structured("p", SummaryShortMedium).short == "s"


def test_structured_path_skipped_when_capability_absent():
    s = _synth(_FakeLLM(structured_result=SummaryShortMedium(short="s", medium="m")), _PLAIN_CAPS)
    assert s._call_structured("p", SummaryShortMedium) is None


def test_structured_failure_returns_none_so_caller_falls_back():
    s = _synth(_FakeLLM(structured_result=ValueError("schema violation")), _STRUCTURED_CAPS)
    assert s._call_structured("p", SummaryShortMedium) is None


def test_effort_is_bound_when_model_supports_it():
    llm = _FakeLLM(structured_result=SummaryShortMedium(short="s", medium="m"))
    _synth(llm, _STRUCTURED_CAPS)._call_structured("p", SummaryShortMedium, effort="high")
    assert {"reasoning_effort": "high"} in llm.bind_calls


def test_effort_not_bound_when_model_lacks_the_knob():
    llm = _FakeLLM()
    _synth(llm, _PLAIN_CAPS)._call("p", effort="high")
    assert llm.bind_calls == []


def test_unsupported_effort_level_is_not_bound():
    llm = _FakeLLM()
    _synth(llm, _STRUCTURED_CAPS)._call("p", effort="xhigh")   # not in this model's tuple
    assert llm.bind_calls == []


def test_call_returns_text_and_survives_provider_error():
    class _Raiser(_FakeLLM):
        def invoke(self, prompt):
            raise RuntimeError("provider down")

    assert _synth(_FakeLLM(), _PLAIN_CAPS)._call("p") == "SUMMARY: s\nOVERVIEW: m"
    assert _synth(_Raiser(), _PLAIN_CAPS)._call("p") == ""


def test_key_points_falls_back_to_text_when_structured_result_is_all_too_short():
    # Structured result parses fine but every point is <=15 chars after strip,
    # so it gets filtered to []. Before the fix, _make_key_points returned early
    # here with out.key_points == [] and the Key Points panel silently vanished.
    llm = _FakeLLM(
        structured_result=KeyPoints(points=["Chưa đủ dữ liệu"]),  # too short after strip (<=15 chars)
        text="[FINDING] a valid fallback key point from the text parse path",
    )
    s = _synth(llm, _STRUCTURED_CAPS)
    out = ResearchOutput(query="q")

    s._make_key_points("q", "ctx", out)

    assert out.key_points == ["[FINDING] a valid fallback key point from the text parse path"]
