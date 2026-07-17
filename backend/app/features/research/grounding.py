"""Citation grounding cho Research.

Lõi thẩm định (is_grounded, confidence, limitations) là HÀM THUẦN dựa trên tín
hiệu lexical (token-overlap) — deterministic, không I/O, không phụ thuộc embedding.
LLM chỉ dùng để TRÍCH claim (extract_claims); việc claim có được nguồn hỗ trợ hay
không do hàm thuần quyết định. Mọi bước LLM có fallback ở lớp gọi.
"""
import logging
import re

from backend.app.features.research.models import Claim, SearchResult
from backend.app.features.research.security import frame_untrusted, UNTRUSTED_GUARD

logger = logging.getLogger(__name__)

_TOKEN_RE = re.compile(r"[a-z0-9]+")


def tokenize(text: str) -> set[str]:
    return {t for t in _TOKEN_RE.findall((text or "").lower()) if len(t) >= 3}


def lexical_support(claim_text: str, source_text: str) -> float:
    a, b = tokenize(claim_text), tokenize(source_text)
    if not a or not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0


def is_grounded(claim_text: str, source_texts: list[str], threshold: float = 0.12) -> bool:
    return any(lexical_support(claim_text, s) >= threshold for s in source_texts)


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
    abstract_only = [s for s in sources if s.source in ("arxiv", "semantic_scholar", "huggingface", "openalex") and len(s.content) < 400]
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


def _claim_extraction_prompt(query: str, sources: list[SearchResult]) -> str:
    numbered = "\n".join(
        f"[{i+1}] {s.title}: {frame_untrusted(s.content[:400])}" for i, s in enumerate(sources)
    )
    return (
        f"{UNTRUSTED_GUARD}\n\n"
        f"From the sources below, extract up to 8 factual claims that answer: {query}\n\n"
        f"Sources:\n{numbered}\n\n"
        f'Return ONLY a JSON array. Each item: '
        f'{{"text": "the claim", "source_id": <source number>, '
        f'"evidence_type": "direct|inference|opinion|uncertain"}}\n'
        f"Use the source number that best supports each claim."
    )


def extract_claims(query, sources, llm_call, parse_array) -> list[Claim]:
    if not sources:
        return []
    try:
        raw = llm_call(_claim_extraction_prompt(query, sources))
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
        claims.append(Claim(text=text, source_ids=source_ids, evidence_type=et))
    return claims


class ClaimAuditor:
    def __init__(self, threshold: float = 0.12):
        self._threshold = threshold

    def verify(self, claims: list[Claim], sources: list[SearchResult]) -> list[Claim]:
        by_id = {s.id: s.content for s in sources}
        for c in claims:
            cited = [by_id[sid] for sid in c.source_ids if sid in by_id]
            c.grounded = is_grounded(c.text, cited, self._threshold)
            if not c.grounded and c.evidence_type == "direct":
                c.evidence_type = "uncertain"   # gán bảo thủ
        return claims
