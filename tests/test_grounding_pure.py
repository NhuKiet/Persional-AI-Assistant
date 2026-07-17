# tests/test_grounding_pure.py
from backend.app.features.research.models import SearchResult, Claim
from backend.app.features.research.grounding import (
    tokenize, lexical_support, is_grounded, compute_confidence, derive_limitations,
)


def test_tokenize_drops_short_tokens_and_lowercases():
    assert tokenize("The Transformer, a Neural net!") == {"the", "transformer", "neural", "net"}


def test_lexical_support_full_overlap_is_one():
    assert lexical_support("neural network model", "neural network model") == 1.0


def test_lexical_support_no_overlap_is_zero():
    assert lexical_support("apples oranges", "quantum chromodynamics") == 0.0


def test_is_grounded_true_when_a_source_supports():
    claim = "transformers use self attention mechanisms"
    sources = ["Unrelated text about cooking", "Transformers use self attention for sequence modeling"]
    assert is_grounded(claim, sources, threshold=0.12) is True


def test_is_grounded_false_when_no_support():
    assert is_grounded("banana bread recipe", ["quantum field theory lecture"], threshold=0.12) is False


def test_is_grounded_empty_sources_false():
    assert is_grounded("anything", [], threshold=0.12) is False


def test_compute_confidence_monotonic_in_grounded_fraction():
    g = [Claim(text="a", source_ids=["1"], grounded=True),
         Claim(text="b", source_ids=["1"], grounded=True)]
    mixed = [Claim(text="a", source_ids=["1"], grounded=True),
             Claim(text="b", source_ids=[], grounded=False)]
    assert compute_confidence(g, n_sources=5) > compute_confidence(mixed, n_sources=5)


def test_compute_confidence_penalizes_few_sources():
    g = [Claim(text="a", source_ids=["1"], grounded=True)]
    assert compute_confidence(g, n_sources=1) < compute_confidence(g, n_sources=8)


def test_compute_confidence_no_claims_is_zero():
    assert compute_confidence([], n_sources=5) == 0.0


def test_derive_limitations_flags_ungrounded_and_abstract_only():
    sources = [SearchResult(source="arxiv", title="P", url="u", content="abstract only")]
    claims = [Claim(text="x", source_ids=[], grounded=False)]
    lims = derive_limitations(sources, claims)
    assert any("nguồn" in l.lower() for l in lims)      # có nhắc tới giới hạn nguồn/claim
    assert isinstance(lims, list) and all(isinstance(l, str) for l in lims)
