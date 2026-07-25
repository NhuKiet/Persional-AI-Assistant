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
    # `chunks` arrives ranked by relevance (highest score first). Two chunks
    # from the same page cite the same "source" from the reader's point of
    # view — keeping both produced visually-duplicate "Trang N" chips — so
    # dedupe down to the single highest-scoring chunk per page. The kept
    # chunks are then re-sorted by page number: relevance order picked *which*
    # pages to cite, but showing citations out of page order read as random
    # to the user, so display order should follow the document instead.
    sources: list[dict] = []
    seen_pages: set[int] = set()
    for chunk in chunks:
        if chunk.page in seen_pages:
            continue
        seen_pages.add(chunk.page)
        sources.append({
            "page": chunk.page,
            "chunk_index": chunk.index,
            "excerpt": _excerpt(chunk.text, excerpt_chars),
        })
        if len(sources) == limit:
            break
    sources.sort(key=lambda source: source["page"])
    return sources
