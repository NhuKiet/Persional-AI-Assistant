from backend.app.features.research.models import ResearchOutput, Claim
from backend.app.features.research.iteration import needs_iteration, gap_query


def _out(n_claims=0, confidence=None, follow_ups=None):
    o = ResearchOutput(query="q")
    o.claims = [Claim(text=f"c{i}", source_ids=["x"], grounded=True) for i in range(n_claims)]
    o.confidence = confidence
    o.follow_up_questions = follow_ups or []
    return o


def test_needs_iteration_true_when_few_claims_and_budget_left():
    assert needs_iteration(_out(n_claims=1, confidence=0.9), rounds_done=0, max_rounds=1) is True


def test_needs_iteration_true_when_low_confidence():
    assert needs_iteration(_out(n_claims=5, confidence=0.3), rounds_done=0, max_rounds=1) is True


def test_needs_iteration_false_when_strong():
    assert needs_iteration(_out(n_claims=5, confidence=0.8), rounds_done=0, max_rounds=1) is False


def test_needs_iteration_false_when_budget_exhausted():
    assert needs_iteration(_out(n_claims=0, confidence=None), rounds_done=1, max_rounds=1) is False


def test_needs_iteration_false_when_max_rounds_zero():
    assert needs_iteration(_out(n_claims=0), rounds_done=0, max_rounds=0) is False


def test_gap_query_prefers_follow_up():
    o = _out(follow_ups=["What about scaling limits?"])
    assert gap_query("original", o) == "What about scaling limits?"


def test_gap_query_falls_back_to_evidence_framing():
    assert gap_query("neural nets", _out()) == "neural nets evidence details"


def test_gap_query_empty_query_returns_none():
    assert gap_query("   ", _out()) is None


def test_needs_iteration_true_when_confidence_none_and_claims_strong():
    assert needs_iteration(_out(n_claims=5, confidence=None), rounds_done=0, max_rounds=1) is True


def test_gap_query_truncates_long_follow_up_to_200_chars():
    long_fq = "a" * 250
    o = _out(follow_ups=[long_fq])
    result = gap_query("original", o)
    assert len(result) == 200


def test_gap_query_truncates_long_evidence_framing_to_200_chars():
    long_query = "x" * 250
    result = gap_query(long_query, _out())
    assert len(result) == 200


def test_gap_query_whitespace_only_follow_up_falls_back_to_evidence_framing():
    o = _out(follow_ups=["   "])
    assert gap_query("neural nets", o) == "neural nets evidence details"
