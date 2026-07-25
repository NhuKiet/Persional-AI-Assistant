"""Quyết định dùng knowledge đã lưu hay search live.

Tầng 1 (thuần, không I/O): phân loại độ mới theo loại câu hỏi, tính độ phủ,
suy ra trạng thái EMPTY/STALE/THIN/MAYBE.
Tầng 2 (LLM tiêm vào): judge đủ/thiếu, có hardening chống prompt injection.

Mọi thất bại đều nghiêng về phía "search thêm" — xem spec
docs/superpowers/specs/2026-07-25-rag-search-decision-design.md.
"""
from __future__ import annotations

import datetime
import logging
import re
import time

from backend.app.core.config import settings
from backend.app.features.research.security import frame_untrusted, UNTRUSTED_GUARD

logger = logging.getLogger(__name__)

_ENABLED        = settings.RESEARCH_SUFFICIENCY_ENABLED
_COVERAGE_MIN   = settings.KNOWLEDGE_COVERAGE_MIN
_TTL_VOLATILE   = settings.KNOWLEDGE_TTL_VOLATILE_DAYS
_TTL_STABLE     = settings.KNOWLEDGE_TTL_STABLE_DAYS
_TTL_DEFAULT    = settings.KNOWLEDGE_TTL_DEFAULT_DAYS
_JUDGE_TIMEOUT  = settings.RESEARCH_JUDGE_TIMEOUT_SECONDS

# Trạng thái — dùng luôn làm giá trị `reason` của SSE knowledge_decision.
EMPTY = "empty"
STALE = "stale"
THIN  = "thin"
MAYBE = "maybe"

# Unicode-aware: grounding.tokenize dùng [a-z0-9]+ nên rụng hết chữ có dấu.
# Với app ưu tiên tiếng Việt, dùng lại nó sẽ cho coverage ~0 và mọi câu hỏi
# tiếng Việt đều bị xếp THIN.
_TOKEN_RE = re.compile(r"\w+", re.UNICODE)

_VOLATILE_KW = {
    "sota", "state-of-the-art", "benchmark", "latest", "newest", "current",
    "mới nhất", "hiện tại", "phiên bản", "version", "release", "pricing",
    "giá", "xu hướng", "trend", "top", "best",
}

_STABLE_KW = {
    "là gì", "what is", "định nghĩa", "definition", "nguyên lý", "principle",
    "kiến trúc", "architecture", "hoạt động thế nào", "how does",
    "giải thích", "explain", "lịch sử", "history",
}

_YEAR_RE = re.compile(r"\b20\d{2}\b")


def tokens(text: str) -> set[str]:
    return {t for t in _TOKEN_RE.findall((text or "").lower()) if len(t) >= 3}


def _has_recent_year(query: str, now: float) -> bool:
    """Năm được phát hiện động, không hardcode — hardcode "2025, 2026" sẽ
    tự hết hạn trong im lặng."""
    current_year = datetime.datetime.fromtimestamp(now).year
    return any(
        int(m) >= current_year - 1 for m in _YEAR_RE.findall(query or "")
    )


def classify_freshness(query: str, now: float | None = None) -> str:
    now = time.time() if now is None else now
    q = (query or "").lower()
    # volatile kiểm tra TRƯỚC stable: "YOLOv11 mới nhất là gì" khớp cả hai.
    if any(kw in q for kw in _VOLATILE_KW) or _has_recent_year(q, now):
        return "volatile"
    if any(kw in q for kw in _STABLE_KW):
        return "stable"
    return "default"


def ttl_days_for(freshness_class: str) -> int:
    return {
        "volatile": _TTL_VOLATILE,
        "stable":   _TTL_STABLE,
    }.get(freshness_class, _TTL_DEFAULT)


def evidence_age_days(source, now: float) -> float | None:
    """Tuổi bằng chứng, tính theo ngày xuất bản nếu biết, không thì theo
    thời điểm lưu. Một paper 2020 vừa index hôm nay KHÔNG phải bằng chứng
    hiện hành. Trả None khi không có mốc thời gian nào."""
    extra = getattr(source, "extra", None) or {}
    ts = extra.get("published_at")
    if ts is None:
        ts = extra.get("stored_at")
    if ts is None:
        return None
    try:
        return (now - float(ts)) / 86400.0
    except (TypeError, ValueError):
        return None


def is_fresh(source, ttl_days: int, now: float, unknown_ok: bool) -> bool:
    age = evidence_age_days(source, now)
    if age is None:
        return unknown_ok
    return age <= ttl_days


def fresh_subset(sources: list, ttl_days: int, now: float, unknown_ok: bool) -> list:
    return [s for s in sources if is_fresh(s, ttl_days, now, unknown_ok)]


def query_coverage(query: str, sources: list) -> float:
    """Tỉ lệ token của câu hỏi xuất hiện trong nội dung nguồn.

    LUÔN gọi trên tập nguồn CÒN TƯƠI, không phải toàn bộ candidate — một
    snippet mới mà lạc đề không được làm chín nguồn cũ trông như còn hạn.
    """
    q = tokens(query)
    if not q:
        return 1.0          # câu hỏi suy biến → nhường quyết định cho tầng 2
    if not sources:
        return 0.0
    body = tokens(" ".join((s.content or "") for s in sources))
    return len(q & body) / len(q)


def assess(query: str, candidates: list, now: float | None = None) -> tuple[str, list]:
    """Trả (state, fresh_sources).

    Nguồn không rõ tuổi bị loại khỏi fresh subset khi câu hỏi thuộc loại
    volatile — với volatile mà toàn bộ candidate đều không rõ tuổi thì fresh
    subset rỗng, tức STALE, tức full live search. Với stable/default thì cho
    qua để tầng 2 phán, tránh vô hiệu hoá cả knowledge store cũ cùng lúc.
    """
    now = time.time() if now is None else now
    if not candidates:
        return EMPTY, []

    cls        = classify_freshness(query, now)
    ttl        = ttl_days_for(cls)
    unknown_ok = cls != "volatile"
    fresh      = fresh_subset(candidates, ttl, now, unknown_ok)

    if not fresh:
        return STALE, []
    if query_coverage(query, fresh) < _COVERAGE_MIN:
        return THIN, fresh
    return MAYBE, fresh


_JUDGE_SRC_CHARS   = 400     # mỗi nguồn
_JUDGE_CTX_CHARS   = 4000    # tổng ngữ cảnh
_MAX_MISSING_CHARS = 200
_MAX_TOPUP_CHARS   = 400
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")


def build_judge_prompt(query: str, sources: list) -> str:
    """Nội dung nguồn là dữ liệu ngoài, có thể chứa chỉ thị nhắm vào judge —
    khung untrusted y như grounding._claim_extraction_prompt."""
    parts, total = [], 0
    for s in sources:
        chunk = (
            f"[{s.id}] {s.title}\n"
            f"{frame_untrusted((s.content or '')[:_JUDGE_SRC_CHARS])}"
        )
        if total + len(chunk) > _JUDGE_CTX_CHARS:
            break
        parts.append(chunk)
        total += len(chunk)

    return (
        f"{UNTRUSTED_GUARD}\n\n"
        f"Question: {query}\n\n"
        f"Stored context:\n" + "\n\n---\n\n".join(parts) + "\n\n"
        f"Does the stored context contain enough evidence to answer the "
        f"question fully and specifically?\n"
        f"Return ONLY JSON: "
        f'{{"sufficient": true|false, "missing": "what specific evidence is missing"}}'
    )


def validate_judge_response(obj) -> tuple[bool, str | None]:
    """Bất kỳ thứ gì không qua được validation đều bị coi là THIẾU."""
    if not isinstance(obj, dict):
        return False, None

    sufficient = obj.get("sufficient")
    if sufficient is True:
        return True, None
    if not isinstance(sufficient, bool):
        # "yes"/"1"/1 không được ép kiểu — chuỗi truthy là tín hiệu hỏng.
        return False, None

    missing = obj.get("missing")
    if not isinstance(missing, str):
        return False, None
    missing = _CONTROL_RE.sub(" ", missing).strip()[:_MAX_MISSING_CHARS].strip()
    return False, missing or None


def anchor_gap_query(effective_query: str, missing: str | None) -> str:
    """Query top-up LUÔN neo vào câu hỏi gốc, không bao giờ dùng `missing`
    đứng một mình.

    Quy tắc cũ "missing phải chia sẻ ít nhất 1 token với câu hỏi" quá yếu:
    văn bản độc hại chỉ cần lặp lại một từ khoá là qua, rồi tự do lái phần
    còn lại. Neo thì loại bỏ bề mặt tấn công thay vì đi kiểm tra nó.
    """
    base = (effective_query or "").strip()
    gap  = (missing or "").strip()
    if not gap:
        return base
    combined = f"{base} {gap}"
    if len(combined) <= _MAX_TOPUP_CHARS:
        return combined
    # Cắt thì cắt phần bổ sung — câu hỏi người dùng luôn sống sót.
    room = _MAX_TOPUP_CHARS - len(base) - 1
    return f"{base} {gap[:room]}".strip() if room > 0 else base


def judge_sufficiency(query, sources, llm_call, parse_obj) -> tuple[bool, str | None]:
    if not sources:
        return False, None
    try:
        raw = llm_call(build_judge_prompt(query, sources))
        return validate_judge_response(parse_obj(raw))
    except Exception as e:  # noqa: BLE001 — non-fatal, nghiêng về search thêm
        logger.warning("judge_sufficiency failed (non-fatal): %s", e)
        return False, None
