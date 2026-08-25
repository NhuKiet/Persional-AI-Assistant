"""Citation grounding cho Research. Prompt text lives in research/prompts.py.

Lõi thẩm định (is_grounded, confidence, limitations) là HÀM THUẦN dựa trên tín
hiệu lexical (token-overlap) — deterministic, không I/O, không phụ thuộc embedding.
LLM chỉ dùng để TRÍCH claim (extract_claims); việc claim có được nguồn hỗ trợ hay
không do hàm thuần quyết định. Mọi bước LLM có fallback ở lớp gọi.
"""
import logging
import re

from backend.app.features.research.models import Claim, SearchResult
from backend.app.features.research.prompts import claim_extraction_prompt
from backend.app.features.research.security import frame_untrusted

logger = logging.getLogger(__name__)

# Unicode-aware. `[a-z0-9]+` drops every accented character, so Vietnamese
# shreds into sub-3-character fragments that the length filter then discards:
# the 2026-08-25 audit (spec section 15) found a Vietnamese claim scoring
# exactly 0.000 against a Vietnamese source stating nearly the same sentence.
# Same fix, same reason, as sufficiency.py:36.
_TOKEN_RE = re.compile(r"\w+", re.UNICODE)


def tokenize(text: str) -> set[str]:
    return {t for t in _TOKEN_RE.findall((text or "").lower()) if len(t) >= 3}


# Anchor terms are required to be at least this long so common short words
# (stopwords in any language, unit-like tokens) can't produce a false match —
# only substantive terms (names, technical vocabulary) count.
_ANCHOR_MIN_TOKEN_LEN = 4

# Above this drop ratio the anchor is presumed wrong, not the corpus.
_ANCHOR_MAX_DROP_RATIO = 0.8


def anchor_tokens(query: str) -> set[str]:
    return {t for t in tokenize(query) if len(t) >= _ANCHOR_MIN_TOKEN_LEN}


def shares_anchor_token(query: str, *texts: str) -> bool:
    """True if `texts` shares at least one substantive token with `query`.

    Cheap, language-agnostic sanity check for keyword-driven search APIs
    (arXiv, HuggingFace, Semantic Scholar…) whose own "relevance" ranking can
    diverge wildly from actual topical relevance — e.g. arXiv matching two
    completely unrelated papers because both titles contain the generic
    boilerplate phrase "A Comparative Study of…". A query too short/generic
    to have any anchor tokens is never filtered (nothing to check against).
    """
    q_tokens = anchor_tokens(query)
    if not q_tokens:
        return True
    doc_tokens = tokenize(" ".join(t for t in texts if t))
    return bool(q_tokens & doc_tokens)


def filter_by_anchor_relevance(
    query: str, results: list[SearchResult], label: str = "",
) -> list[SearchResult]:
    """Drop results that share no substantive term with `query`.

    Meant as a last-resort net against retrieval contamination — apply it
    to raw search-engine output, anchored to the user's actual (clean)
    query, never to an LLM-expanded or gap-filling query (those are
    exactly the noisy text that produces contaminated matches in the
    first place — filtering against them would just rubber-stamp their
    own noise).
    """
    if not results:
        return results
    kept = [r for r in results if shares_anchor_token(query, r.title, r.content)]
    dropped = len(results) - len(kept)
    if not dropped:
        return kept
    # With a unicode tokenizer this filter finally produces anchor tokens for
    # Vietnamese queries — which makes it dangerous, not merely useful: a
    # Vietnamese query against an English corpus shares nothing by
    # construction and would delete every result. Wiping the result set is a
    # far worse failure than skipping a last-resort net, so a near-total drop
    # is read as an anchor/corpus language mismatch instead.
    if dropped / len(results) > _ANCHOR_MAX_DROP_RATIO:
        logger.info(
            "[RELEVANCE] anchor would drop %d/%d — treating as anchor/corpus "
            "language mismatch, keeping all%s",
            dropped, len(results), f" ({label})" if label else "",
        )
        return results
    logger.info(
        "[RELEVANCE] dropped %d/%d results with no anchor-token overlap%s",
        dropped, len(results), f" ({label})" if label else "",
    )
    return kept


def containment(claim_text: str, source_text: str) -> float:
    """Fraction of the claim's tokens that appear in the source, in [0, 1].

    This replaced Jaccard, which is a similarity between two sets of comparable
    size and is the wrong shape for this question. A 30-token claim compared
    against a 900-token document has a union dominated by the document, so a
    verbatim quotation still scores low — the 2026-08-25 audit found supported
    claims scoring 0.037 and 0.010 against sources that restated them almost
    word for word. "Is the claim contained in the source" is the question
    actually being asked, and containment is what asks it.
    """
    a, b = tokenize(claim_text), tokenize(source_text)
    if not a or not b:
        return 0.0
    return len(a & b) / len(a)


# Kept as the module's public support metric so callers do not need to know
# which formula is in use.
lexical_support = containment


# Containment runs higher than Jaccard for the same pair, so the old 0.12 does
# not carry over. 0.55 sits below the supported claims measured in the audit
# and above the unsupported control.
LEXICAL_THRESHOLD = 0.55


def is_grounded(claim_text: str, source_texts: list[str],
                threshold: float = LEXICAL_THRESHOLD) -> bool:
    return any(containment(claim_text, s) >= threshold for s in source_texts)


# ── Quote-anchored verification ──────────────────────────────────────────────
# Lexical measures cannot settle a semantic question. In the audit, accepted
# and rejected claims had overlapping containment distributions (0.24-0.92 vs
# 0.12-0.93) because both groups were supported — what separated them was
# surface similarity, not support. Asking the model to copy the sentence it
# relied on, then checking that sentence really occurs in the source, replaces
# the similarity judgement with a lookup.

QUOTE_THRESHOLD = 0.85

# Below this length a quote matches almost any source by accident — a model
# answering "AI" would ground every claim.
_QUOTE_MIN_CHARS = 20

_PUNCT_MAP = str.maketrans({
    "‘": "'", "’": "'", "‚": "'", "‛": "'",
    "“": '"', "”": '"', "„": '"', "‟": '"',
    "‐": "-", "‑": "-", "‒": "-", "–": "-",
    "—": "-", "―": "-", " ": " ",
})


def normalize(text: str) -> str:
    """Lowercase, fold typographic punctuation to ASCII, collapse whitespace."""
    if not text:
        return ""
    return " ".join(text.translate(_PUNCT_MAP).lower().split())


def quote_support(quote: str, source: str) -> float:
    """How well `quote` is backed by `source`, in [0, 1].

    1.0 when the normalized quote occurs verbatim; otherwise the fraction of
    the quote's tokens present in the source, which tolerates a model that
    copied almost faithfully while still failing an invention.
    """
    q, s = normalize(quote), normalize(source)
    if len(q) < _QUOTE_MIN_CHARS or not s:
        return 0.0
    if q in s:
        return 1.0
    return containment(q, s)


def compute_confidence(claims: list[Claim], n_sources: int) -> float:
    if not claims:
        return 0.0
    grounded_frac = sum(1 for c in claims if c.grounded) / len(claims)
    # bão hòa số nguồn: 1 nguồn ~0.4, >=8 nguồn ~1.0
    source_factor = min(1.0, 0.3 + n_sources / 10.0)
    return round(grounded_frac * source_factor, 3)


def derive_limitations(sources: list[SearchResult], claims: list[Claim]) -> list[str]:
    lims: list[str] = []
    ungrounded = [c for c in claims if not c.grounded]
    if ungrounded:
        lims.append(f"{len(ungrounded)} nhận định không tìm được nguồn hỗ trợ trực tiếp.")
    if len(sources) < 3:
        lims.append(f"Chỉ có {len(sources)} nguồn — độ đa dạng bằng chứng thấp.")
    abstract_only = [s for s in sources if s.source in ("arxiv", "semantic_scholar", "huggingface") and len(s.content) < 400]
    if abstract_only:
        lims.append(f"{len(abstract_only)} nguồn học thuật chỉ có tóm tắt (abstract), không phải toàn văn.")
    grounded_claims = [c for c in claims if c.grounded]
    cited_ids = {sid for c in grounded_claims for sid in c.source_ids}
    if len(grounded_claims) >= 2 and len(cited_ids) == 1:
        lims.append(
            "Phần lớn nhận định chỉ dựa trên một nguồn — cần thêm nguồn độc lập để đối chứng."
        )
    return lims


_EVIDENCE_TYPES = {"direct", "inference", "opinion", "uncertain"}


def _numbered_sources(sources: list[SearchResult]) -> str:
    return "\n".join(
        f"[{i+1}] {s.title}: {frame_untrusted(s.content[:400])}" for i, s in enumerate(sources)
    )


def extract_claims(query, sources, llm_call, parse_array, structured_call=None) -> list[Claim]:
    """`structured_call` is an injected callable returning an object with a
    `.claims` list carrying text/source_id/evidence_type, or None to use the
    text path. Injected, not imported, so this module stays pure."""
    if not sources:
        return []
    parsed = None
    if structured_call is not None:
        try:
            result = structured_call(claim_extraction_prompt(query, _numbered_sources(sources)))
            if result is not None:
                parsed = [item.model_dump() for item in result.claims]
        except Exception as e:  # noqa: BLE001
            logger.warning("structured claim extraction failed (non-fatal): %s", e)
    if parsed is None:
        try:
            raw = llm_call(claim_extraction_prompt(query, _numbered_sources(sources)))
            parsed = parse_array(raw)
        except Exception as e:  # noqa: BLE001
            logger.warning("extract_claims failed (non-fatal): %s", e)
            return []

    claims: list[Claim] = []
    for item in parsed:
        if not isinstance(item, dict) or "text" not in item:
            continue
        text = str(item.get("text", "")).strip()
        if not text:
            continue
        idx = item.get("source_id")
        source_ids: list[str] = []
        try:
            i = int(idx) - 1
            if 0 <= i < len(sources):
                source_ids = [sources[i].id]
        except (TypeError, ValueError):
            source_ids = []
        et = str(item.get("evidence_type", "uncertain")).lower()
        if et not in _EVIDENCE_TYPES:
            et = "uncertain"
        quote = str(item.get("quote", "") or "").strip()[:400]
        claims.append(Claim(
            text=text, source_ids=source_ids, evidence_type=et, quote=quote,
        ))
    return claims


# Cosine threshold for the batch fallback. Measured on Vietnamese claims
# against their English sources: faithful pairs scored 0.29 and 0.62, an
# unrelated control 0.02.
FALLBACK_THRESHOLD = 0.2

# Claim-to-quote relatedness. Measured: 16 real pairs spanned 0.33-0.86 and
# deliberately mismatched pairs scored -0.03 and 0.03, so 0.2 sits in a gap an
# order of magnitude wide on both sides.
QUOTE_RELATEDNESS_THRESHOLD = 0.2

_FALLBACK_MIN_CLAIMS = 3
_FALLBACK_MAX_GROUNDED_FRAC = 0.3


class ClaimAuditor:
    """Decides which claims their cited source actually supports.

    Three tiers, in order of how directly they answer the question:

    1. The quote the model copied really occurs in the source it cited.
    2. No usable quote: fall back to token containment, which works when the
       claim and the source share a language.
    3. The quote signal collapsed across the whole batch — evidence the
       *signal* is unusable (a model that paraphrased instead of copying),
       not that every claim is fabricated. An injected semantic scorer then
       re-decides. It is injected rather than imported so this module keeps
       no dependency on embeddings and stays testable without a network.
    """

    def __init__(
        self,
        threshold: float = LEXICAL_THRESHOLD,
        quote_threshold: float = QUOTE_THRESHOLD,
        fallback_scorer=None,
    ):
        self._threshold = threshold
        self._quote_threshold = quote_threshold
        self._fallback_scorer = fallback_scorer

    def verify(self, claims: list[Claim], sources: list[SearchResult]) -> list[Claim]:
        by_id = {s.id: s.content for s in sources}
        cited_map = {
            id(c): [by_id[sid] for sid in c.source_ids if sid in by_id] for c in claims
        }

        for c in claims:
            cited = cited_map[id(c)]
            if c.quote:
                c.grounded = any(
                    quote_support(c.quote, src) >= self._quote_threshold for src in cited
                )
            else:
                c.grounded = is_grounded(c.text, cited, self._threshold)

        self._check_quote_relatedness(claims)

        if self._should_fall_back(claims):
            self._apply_fallback(claims, cited_map)

        for c in claims:
            if not c.grounded and c.evidence_type == "direct":
                c.evidence_type = "uncertain"   # gán bảo thủ
        return claims

    def _check_quote_relatedness(self, claims: list[Claim]) -> None:
        """A real quote is not automatically the *right* quote.

        Checking only that the quote occurs in the source leaves one hole: a
        claim paired with a genuine but irrelevant sentence passes. Verified
        directly — a fabricated "12x faster" claim carrying a real sentence
        about dataset collection was accepted before this check existed.

        Lexical comparison cannot close it, because a quarter of real pairs
        are a Vietnamese claim beside an English quote and score ~0 by
        construction. Measured with embeddings instead, the two populations
        separate by an order of magnitude: 16 real pairs spanned 0.33-0.86,
        deliberately mismatched pairs scored -0.03 and 0.03.

        Skipped entirely when no scorer is injected, which keeps this module
        pure and unit-testable without a network.
        """
        if self._fallback_scorer is None:
            return
        quoted = [c for c in claims if c.grounded and c.quote]
        if not quoted:
            return
        try:
            scores = self._fallback_scorer([(c.text, c.quote) for c in quoted])
        except Exception as e:  # noqa: BLE001 — keep the quote verdicts
            logger.warning("[GROUNDING] relatedness scorer failed (non-fatal): %s", e)
            return
        if not scores or len(scores) != len(quoted):
            return
        dropped = 0
        for c, score in zip(quoted, scores):
            if score < QUOTE_RELATEDNESS_THRESHOLD:
                c.grounded = False
                dropped += 1
        if dropped:
            logger.info(
                "[GROUNDING] %d claim(s) cited a real quote that does not support them",
                dropped,
            )

    def _should_fall_back(self, claims: list[Claim]) -> bool:
        if self._fallback_scorer is None or len(claims) < _FALLBACK_MIN_CLAIMS:
            return False
        grounded_frac = sum(1 for c in claims if c.grounded) / len(claims)
        return grounded_frac < _FALLBACK_MAX_GROUNDED_FRAC

    def _apply_fallback(self, claims: list[Claim], cited_map: dict) -> None:
        pairs = [(c.text, " ".join(cited_map[id(c)])) for c in claims]
        try:
            scores = self._fallback_scorer(pairs)
        except Exception as e:  # noqa: BLE001 — keep the quote verdicts
            logger.warning("[GROUNDING] fallback scorer failed (non-fatal): %s", e)
            return
        if not scores or len(scores) != len(claims):
            logger.warning(
                "[GROUNDING] fallback scorer returned %d scores for %d claims — ignoring",
                len(scores or []), len(claims),
            )
            return
        logger.info(
            "[GROUNDING] quote signal unusable across %d claims — re-verified semantically",
            len(claims),
        )
        for c, score in zip(claims, scores):
            c.grounded = score >= FALLBACK_THRESHOLD
