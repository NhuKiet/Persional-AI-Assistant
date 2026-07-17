from backend.app.features.research.models import SearchResult
from backend.app.features.research.synthesizer import Synthesizer


class _FakeLLM:
    def __init__(self, responses): self._r = responses; self.i = 0
    def invoke(self, prompt):
        import types
        # trả JSON claim khi prompt hỏi claim; ngược lại trả text vô hại
        content = '[{"text":"transformers self attention sequence modeling","source_id":1,"evidence_type":"direct"}]' \
                  if "extract up to 8 factual claims" in prompt else "SUMMARY: ok\nOVERVIEW: ok"
        return types.SimpleNamespace(content=content)


def _sources():
    return [SearchResult(source="web", title="A", url="ua",
                         content="Transformers use self attention for sequence modeling.")]


def test_synthesize_grounded_attaches_grounded_claims(monkeypatch):
    import backend.app.core.config as cfg
    monkeypatch.setattr(cfg.settings, "RESEARCH_GROUNDING_ENABLED", True, raising=False)
    synth = Synthesizer(_FakeLLM({}))
    out = synth.synthesize_grounded("what do transformers use?", _sources())
    assert out.summary_short                       # vẫn có output cũ
    assert len(out.claims) == 1
    assert out.claims[0].grounded is True
    assert out.claims[0].source_ids == [_sources()[0].id]
    assert out.confidence is not None


def test_synthesize_grounded_falls_back_when_disabled(monkeypatch):
    import backend.app.core.config as cfg
    monkeypatch.setattr(cfg.settings, "RESEARCH_GROUNDING_ENABLED", False, raising=False)
    synth = Synthesizer(_FakeLLM({}))
    out = synth.synthesize_grounded("q", _sources())
    assert out.claims == []
    assert out.confidence is None
