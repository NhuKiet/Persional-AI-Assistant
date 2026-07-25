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
