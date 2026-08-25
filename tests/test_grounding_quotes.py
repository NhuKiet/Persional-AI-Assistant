# tests/test_grounding_quotes.py
"""Verification primitives for quote-anchored grounding.

Cases here are taken from the 2026-08-25 claim audit (spec section 15), where
all 22 sampled claims were genuinely supported and the auditor rejected 11 of
them. Each mechanism the audit identified gets a test that fails under the old
lexical rule.
"""
from backend.app.features.research.grounding import (
    QUOTE_THRESHOLD, containment, lexical_support, normalize, quote_support, tokenize,
)

SOURCE_EN = (
    "Diffusion models are increasingly replacing GANs for image synthesis "
    "tasks due to better mode coverage. DPO reduces training time by 40% "
    "compared to PPO while maintaining similar reward model performance."
)

# Audit case 5: claim and source both Vietnamese, near-identical wording,
# scored exactly 0.000 by the ASCII tokenizer.
CLAIM_VI = "Nên đánh giá liên tục chất lượng phản hồi bằng các bộ dữ liệu kiểm thử thực tế."
SOURCE_VI = (
    "Đánh Giá và Kiểm Tra Liên Tục: Luôn đánh giá chất lượng phản hồi của hệ "
    "thống RAG bằng các bộ dữ liệu kiểm thử thực tế. Các chỉ số như độ chính "
    "xác (precision), độ phủ (recall) của retrieval là rất quan trọng."
)


# ── tokenizer ────────────────────────────────────────────────────────────────

def test_tokenize_keeps_vietnamese_words_whole():
    toks = tokenize("mô hình khuếch tán")
    assert "khuếch" in toks
    assert "hình" in toks


def test_tokenize_still_matches_ascii_as_before():
    assert tokenize("The Transformer, a Neural net!") == {"the", "transformer", "neural", "net"}


# ── containment vs jaccard ───────────────────────────────────────────────────

def test_containment_is_high_for_a_claim_quoted_from_a_long_source():
    """Audit cases 1-4: Jaccard's union is dominated by the document, so a
    verbatim restatement scores low. Containment asks the right question."""
    claim = "DPO reduces training time by 40% compared to PPO"
    assert containment(claim, SOURCE_EN) > 0.9
    assert lexical_support(claim, SOURCE_EN) > 0.9


def test_containment_is_low_for_an_unsupported_claim():
    assert containment("Kubernetes autoscaling uses horizontal pod autoscalers", SOURCE_EN) < 0.3


def test_containment_of_vietnamese_claim_in_vietnamese_source():
    """The exact pair that scored 0.000 in production."""
    assert containment(CLAIM_VI, SOURCE_VI) > 0.8


def test_containment_empty_claim_is_zero():
    assert containment("", SOURCE_EN) == 0.0
    assert containment("   ", SOURCE_EN) == 0.0


# ── normalize ────────────────────────────────────────────────────────────────

def test_normalize_collapses_whitespace_and_lowercases():
    assert normalize("  The   Sky\nis BLUE  ") == "the sky is blue"


def test_normalize_maps_curly_quotes_and_dashes_to_ascii():
    assert normalize("“state–of‐the‑art”") == '"state-of-the-art"'


# ── quote_support ────────────────────────────────────────────────────────────

def test_quote_support_exact_substring_is_one():
    assert quote_support("Diffusion models are increasingly replacing GANs", SOURCE_EN) == 1.0


def test_quote_support_survives_punctuation_substitution():
    assert quote_support("DPO reduces training time by 40%   compared to PPO", SOURCE_EN) == 1.0


def test_quote_support_works_on_vietnamese():
    quote = "Luôn đánh giá chất lượng phản hồi của hệ thống RAG"
    assert quote_support(quote, SOURCE_VI) == 1.0


def test_quote_support_partial_paraphrase_is_below_threshold():
    quote = "Diffusion approaches have gradually supplanted adversarial networks entirely"
    assert quote_support(quote, SOURCE_EN) < QUOTE_THRESHOLD


def test_quote_shorter_than_minimum_is_rejected():
    assert quote_support("GANs", SOURCE_EN) == 0.0


def test_quote_empty_is_rejected():
    assert quote_support("", SOURCE_EN) == 0.0
    assert quote_support("   ", SOURCE_EN) == 0.0


def test_quote_support_empty_source_is_zero():
    assert quote_support("Diffusion models are increasingly replacing GANs", "") == 0.0
