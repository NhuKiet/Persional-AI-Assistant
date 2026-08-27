from backend.app.features.research.models import ResearchOutput, Claim
from backend.app.features.research.iteration import needs_iteration, gap_query


def _out(n_claims=0, confidence=None, follow_ups=None):
    o = ResearchOutput(query="q")
    o.claims = [Claim(text=f"c{i}", source_ids=["x"], grounded=True) for i in range(n_claims)]
    o.confidence = confidence
    o.follow_up_questions = follow_ups or []
    return o


def test_no_iteration_for_a_narrow_but_well_grounded_answer():
    """Few claims at high confidence means the question was narrow, not that
    the evidence was poor. Measured: a query with 2 claims at confidence 1.0
    tripped the old `len(claims) < 3` rule, and the extra round came back with
    fewer claims than it started with."""
    assert needs_iteration(_out(n_claims=1, confidence=0.9), rounds_done=0, max_rounds=1) is False


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


def test_iterates_when_nothing_was_found():
    """The PhoGPT-4B/VMLU shape from the probe: zero claims and zero
    confidence. This firing rescued the query — 0 claims became 1 at
    confidence 1.0 — and is the case the loop exists for."""
    assert needs_iteration(_out(n_claims=0, confidence=0.0), rounds_done=0, max_rounds=1) is True


def test_does_not_iterate_on_the_shape_that_measurably_hurt():
    """The YaRN shape from the probe: 2 claims, confidence 1.0. Under the old
    rule this fired and made the answer worse."""
    assert needs_iteration(_out(n_claims=2, confidence=1.0), rounds_done=0, max_rounds=1) is False


def test_zero_claims_iterates_even_when_confidence_is_high():
    """Pins the `not output.claims` branch specifically.

    The probe-shaped case above (0 claims, confidence 0.0) is caught by the
    confidence branch too, so deleting the claims branch leaves the whole suite
    green. This input can only pass through the claims branch, and fails if it
    is removed."""
    assert needs_iteration(_out(n_claims=0, confidence=0.9), rounds_done=0, max_rounds=1) is True
