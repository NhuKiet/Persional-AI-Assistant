# tests/test_claim_auditor.py
from backend.app.features.research.grounding import (
    ClaimAuditor, filter_by_anchor_relevance,
)
from backend.app.features.research.models import Claim, SearchResult

SRC_TEXT = (
    "Diffusion models are increasingly replacing GANs for image synthesis "
    "tasks due to better mode coverage."
)


def _source(content=SRC_TEXT):
    return SearchResult(source="web", title="T", url="http://x", content=content)


def _claim(text, quote, source_id):
    return Claim(text=text, source_ids=[source_id], evidence_type="direct", quote=quote)


# ── tier 1: the quote ────────────────────────────────────────────────────────

def test_claim_with_verbatim_quote_is_grounded():
    s = _source()
    c = _claim("Mô hình khuếch tán đang thay thế GAN",
               "Diffusion models are increasingly replacing GANs", s.id)
    assert ClaimAuditor().verify([c], [s])[0].grounded is True


def test_claim_with_invented_quote_is_not_grounded():
    s = _source()
    c = _claim("Mô hình khuếch tán nhanh hơn GAN 12 lần",
               "Diffusion models run twelve times faster than adversarial networks", s.id)
    assert ClaimAuditor().verify([c], [s])[0].grounded is False


def test_ungrounded_direct_claim_is_downgraded_to_uncertain():
    s = _source()
    c = _claim("bịa", "Completely fabricated sentence not present anywhere here", s.id)
    assert ClaimAuditor().verify([c], [s])[0].evidence_type == "uncertain"


# ── tier 2: containment, for claims the model gave no quote ──────────────────

def test_claim_without_quote_falls_back_to_containment():
    """Audit case 1-4 shape: same language, claim restates the source."""
    s = _source()
    c = Claim(text="diffusion models are replacing gans for image synthesis",
              source_ids=[s.id], evidence_type="direct", quote="")
    assert ClaimAuditor().verify([c], [s])[0].grounded is True


def test_unrelated_claim_without_quote_is_not_grounded():
    s = _source()
    c = Claim(text="kubernetes autoscaling horizontal pod replicas",
              source_ids=[s.id], evidence_type="direct", quote="")
    assert ClaimAuditor().verify([c], [s])[0].grounded is False


# ── tier 3: the batch fallback ───────────────────────────────────────────────

def test_batch_fallback_fires_when_quotes_are_unusable():
    s = _source()
    claims = [_claim(f"claim {i}", f"paraphrased sentence number {i} not in source", s.id)
              for i in range(4)]
    seen = {}

    def scorer(pairs):
        seen["pairs"] = pairs
        return [0.9] * len(pairs)

    out = ClaimAuditor(fallback_scorer=scorer).verify(claims, [s])
    assert len(seen["pairs"]) == 4
    assert all(c.grounded for c in out)


def test_batch_fallback_does_not_fire_when_quotes_work():
    """Four claims so the min-claims guard is satisfied and this can only pass
    on the 30% threshold logic — two grounded out of four is 0.5."""
    s = _source()
    claims = [
        _claim("ok1", "Diffusion models are increasingly replacing GANs", s.id),
        _claim("ok2", "for image synthesis tasks due to better mode coverage", s.id),
        _claim("bad1", "invented sentence absent from the source text here", s.id),
        _claim("bad2", "another fabricated sentence nowhere in the source", s.id),
    ]
    called = []

    out = ClaimAuditor(fallback_scorer=lambda p: called.append(p) or []).verify(claims, [s])
    assert sum(1 for c in out if c.grounded) == 2
    assert called == []


def test_batch_fallback_needs_at_least_three_claims():
    s = _source()
    claims = [_claim(f"c{i}", f"invented sentence number {i} absent from source", s.id)
              for i in range(2)]
    called = []

    ClaimAuditor(fallback_scorer=lambda p: called.append(p) or []).verify(claims, [s])
    assert called == []


def test_batch_fallback_scorer_failure_keeps_quote_verdicts():
    s = _source()
    claims = [_claim(f"c{i}", f"invented sentence number {i} absent from source", s.id)
              for i in range(4)]

    out = ClaimAuditor(fallback_scorer=lambda p: []).verify(claims, [s])
    assert all(not c.grounded for c in out)


def test_batch_fallback_raising_scorer_is_non_fatal():
    s = _source()
    claims = [_claim(f"c{i}", f"invented sentence number {i} absent from source", s.id)
              for i in range(4)]

    def boom(pairs):
        raise RuntimeError("embedding service down")

    out = ClaimAuditor(fallback_scorer=boom).verify(claims, [s])
    assert all(not c.grounded for c in out)


# ── anchor filter guard ──────────────────────────────────────────────────────

def _r(title, content=""):
    return SearchResult(source="web", title=title, url="http://x", content=content)


def test_anchor_filter_keeps_all_when_it_would_drop_almost_everything():
    """A unicode tokenizer gives Vietnamese queries real anchor tokens, which
    share nothing with an English corpus. Dropping the whole result set would
    be far worse than skipping the net."""
    results = [_r(f"Diffusion models paper {i}", "English abstract text") for i in range(5)]
    assert len(filter_by_anchor_relevance("mô hình khuếch tán là gì", results)) == 5


def test_anchor_filter_still_drops_a_lone_off_topic_result():
    results = [
        _r("Diffusion models for image synthesis", "diffusion synthesis"),
        _r("Diffusion probabilistic models", "diffusion models"),
        _r("Diffusion in materials science", "diffusion coefficient"),
        _r("Kubernetes autoscaling guide", "horizontal pod autoscaler replicas"),
    ]
    kept = filter_by_anchor_relevance("diffusion models image synthesis", results)
    assert len(kept) == 3
    assert all("Kubernetes" not in r.title for r in kept)


def test_anchor_filter_on_empty_input():
    assert filter_by_anchor_relevance("anything", []) == []
