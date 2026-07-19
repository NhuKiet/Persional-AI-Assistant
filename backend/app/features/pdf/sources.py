from __future__ import annotations

from backend.app.features.pdf.processor import PDFChunk

__all__ = ["serialize_sources"]


def _excerpt(text: str, limit: int) -> str:
    compact = " ".join(text.split())
    if len(compact) <= limit:
        return compact
    return compact[: max(0, limit - 1)].rstrip() + "…"


def serialize_sources(
    chunks: list[PDFChunk],
    limit: int = 5,
    excerpt_chars: int = 180,
) -> list[dict]:
    sources: list[dict] = []
    seen: set[tuple[int, int]] = set()
    for chunk in chunks:
        key = (chunk.page, chunk.index)
        if key in seen:
            continue
        seen.add(key)
        sources.append({
            "page": chunk.page,
            "chunk_index": chunk.index,
            "excerpt": _excerpt(chunk.text, excerpt_chars),
        })
        if len(sources) == limit:
            break
    return sources
