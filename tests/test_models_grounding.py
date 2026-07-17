from backend.app.features.research.models import SearchResult, Claim, ResearchOutput


def test_search_result_id_is_stable_and_deterministic():
    a = SearchResult(source="web", title="T", url="http://x", content="c")
    b = SearchResult(source="web", title="T", url="http://x", content="different")
    assert a.id
    assert a.id == b.id                    # id phụ thuộc url|title, không phụ thuộc content
    assert len(a.id) == 16


def test_search_result_id_respects_explicit_value():
    r = SearchResult(source="web", title="T", url="u", content="c", id="fixed")
    assert r.id == "fixed"


def test_claim_defaults():
    c = Claim(text="x", source_ids=["a"])
    assert c.evidence_type == "uncertain"
    assert c.grounded is True


def test_research_output_grounding_fields_default_empty():
    out = ResearchOutput(query="q")
    assert out.claims == []
    assert out.confidence is None
    assert out.limitations == []
