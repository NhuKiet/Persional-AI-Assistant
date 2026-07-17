from backend.app.features.research.models import SearchResult, Claim
from backend.app.features.research.grounding import extract_claims, ClaimAuditor
import json


def _sources():
    return [
        SearchResult(source="web", title="A", url="ua",
                     content="Transformers use self attention for sequence modeling."),
        SearchResult(source="web", title="B", url="ub",
                     content="Cooking pasta requires boiling water and salt."),
    ]


def test_extract_claims_maps_source_index_to_id():
    src = _sources()
    fake_json = json.dumps([
        {"text": "Transformers use self attention", "source_id": 1, "evidence_type": "direct"},
    ])
    def fake_llm(prompt): return fake_json
    def parse_array(text): return json.loads(text)

    claims = extract_claims("q", src, fake_llm, parse_array)
    assert len(claims) == 1
    assert claims[0].source_ids == [src[0].id]
    assert claims[0].evidence_type == "direct"


def test_extract_claims_bad_output_returns_empty():
    def fake_llm(prompt): return "not json at all"
    def parse_array(text): return []          # parser thất bại → []
    assert extract_claims("q", _sources(), fake_llm, parse_array) == []


def test_auditor_marks_supported_claim_grounded():
    src = _sources()
    claim = Claim(text="transformers self attention sequence", source_ids=[src[0].id])
    out = ClaimAuditor(threshold=0.12).verify([claim], src)
    assert out[0].grounded is True


def test_auditor_marks_unsupported_claim_not_grounded():
    src = _sources()
    claim = Claim(text="pasta boiling water salt recipe", source_ids=[src[0].id])  # trỏ nhầm nguồn A
    out = ClaimAuditor(threshold=0.12).verify([claim], src)
    assert out[0].grounded is False


def test_auditor_claim_with_unknown_source_id_not_grounded():
    src = _sources()
    claim = Claim(text="anything", source_ids=["does-not-exist"])
    out = ClaimAuditor(threshold=0.12).verify([claim], src)
    assert out[0].grounded is False
