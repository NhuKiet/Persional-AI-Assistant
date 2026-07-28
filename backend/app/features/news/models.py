"""Dataclasses shared across the news pipeline (fetcher → summarizer → store)."""
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

_TRACKING_PARAM_PREFIXES = ("utm_",)
_TRACKING_PARAMS = {"ref", "source"}


def normalize_url(url: str) -> str:
    """Chuẩn hoá URL trước khi dedupe/lưu: bỏ fragment, bỏ tracking params
    (utm_*, ref, source), lowercase host. Trailing slash chỉ bỏ khi path
    không kèm query string, để không gộp nhầm hai URL khác nhau trên server
    mà trailing slash có ý nghĩa riêng.

    Returns "" for empty/schemeless input — callers treat that as "skip
    this entry", never as a valid dedupe key.
    """
    if not url or not url.strip():
        return ""
    parts = urlsplit(url.strip())
    if not parts.scheme or not parts.netloc:
        return ""
    query_pairs = [
        (k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if not k.lower().startswith(_TRACKING_PARAM_PREFIXES) and k.lower() not in _TRACKING_PARAMS
    ]
    query = urlencode(query_pairs)
    path = parts.path
    if not query and path.endswith("/") and path != "/":
        path = path.rstrip("/")
    return urlunsplit((parts.scheme, parts.netloc.lower(), path, query, ""))


@dataclass
class NewsItem:
    url: str                      # normalized, dedupe key
    title: str                     # original-language title from RSS
    description_raw: str            # original-language description, pre-truncated by the fetcher
    source: str                     # e.g. "OpenAI Blog", "arXiv cs.RO"
    topic: str                      # model_release | research | robotics | community
    published_at: datetime | None    # UTC, from the feed entry when present
    fetched_at: datetime              # UTC, when this run pulled it
    title_vi: str = ""                 # filled by the summarizer; never empty once stored
    summary_vi: str = ""                # filled by the summarizer; never empty once stored


@dataclass
class RefreshResult:
    new_count: int
