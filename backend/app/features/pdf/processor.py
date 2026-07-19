import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

from backend.app.core.config import settings

logger = logging.getLogger(__name__)

PDF_DIR       = Path(settings.PDF_UPLOAD_DIR)
CHUNK_SIZE    = settings.PDF_CHUNK_SIZE
CHUNK_OVERLAP = settings.PDF_CHUNK_OVERLAP
MAX_CONTEXT   = settings.PDF_MAX_CONTEXT

# ── Full-document summary bounds ────────────────────────────────────────────
# A document above either threshold cannot be safely summarized whole within
# one LLM context window — the caller must reject with a clear scope-limit
# message (never silently summarize a truncated excerpt while claiming to
# have covered the whole document).
FULL_SUMMARY_MAX_PAGES = 100
FULL_SUMMARY_MAX_CHARS = 100_000

# Bounded map-reduce: split into at most MAP_MAX_CHUNKS chunks of at most
# MAP_CHUNK_CHARS each; each chunk's map-summary is capped at MAP_OUTPUT_CHARS;
# the reduce step never sees more than MAP_MAX_CHUNKS * MAP_OUTPUT_CHARS chars.
MAP_CHUNK_CHARS  = 6000
MAP_MAX_CHUNKS   = 16
MAP_OUTPUT_CHARS = 800
REDUCE_INPUT_CHARS = MAP_MAX_CHUNKS * MAP_OUTPUT_CHARS   # 12,800

__all__ = [
    "PDF_DIR", "PDFChunk", "PDFDocument", "PDFProcessor",
    "FULL_SUMMARY_MAX_PAGES", "FULL_SUMMARY_MAX_CHARS",
    "MAP_CHUNK_CHARS", "MAP_MAX_CHUNKS", "MAP_OUTPUT_CHARS", "REDUCE_INPUT_CHARS",
]


# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class PDFChunk:
    page:    int
    index:   int
    text:    str
    score:   float = 0.0


@dataclass
class PDFDocument:
    filename:   str
    total_pages: int
    total_chars: int
    chunks:      list[PDFChunk] = field(default_factory=list)
    # Concatenated cleaned per-page text — kept separate from the small
    # `chunks` (used for RAG retrieval) so map-reduce summarization can
    # split it on its own, larger boundaries.
    full_text:  str = ""

    @property
    def path(self) -> Path:
        return PDF_DIR / self.filename

class PDFProcessor:

    def __init__(self):
        PDF_DIR.mkdir(parents=True, exist_ok=True)

    def extract(self, filename: str) -> PDFDocument:
        try:
            import fitz   # PyMuPDF
        except ImportError:
            raise RuntimeError(
                "PyMuPDF chưa được cài. Chạy: pip install pymupdf"
            )

        path = PDF_DIR / filename
        if not path.exists():
            raise FileNotFoundError(f"PDF không tồn tại: {filename}")

        doc = fitz.open(str(path))
        # Capture the page count up front — independent of whether any page
        # yields extractable text. An image-only / scanned PDF still has a
        # real page count; it must not be reported as 0 pages just because
        # get_text() found nothing to chunk.
        total_pages = doc.page_count

        chunks: list[PDFChunk] = []
        page_texts: list[str] = []
        total_chars = 0

        for page_num, page in enumerate(doc, start=1):
            text = page.get_text("text")
            text = self._clean_text(text)
            if not text.strip():
                continue

            total_chars += len(text)
            page_texts.append(text)
            page_chunks = self._chunk_text(text, page_num)
            chunks.extend(page_chunks)

        doc.close()
        logger.info(f"Extracted {len(chunks)} chunks from {filename} ({total_chars} chars)")

        return PDFDocument(
            filename=filename,
            total_pages=total_pages,
            total_chars=total_chars,
            chunks=chunks,
            full_text="\n\n".join(page_texts),
        )

    def _clean_text(self, text: str) -> str:
        text = re.sub(r"[ \t]{2,}", " ", text)
        text = re.sub(r"^\s*\S{1,2}\s*$", "", text, flags=re.MULTILINE)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()

    def _chunk_text(self, text: str, page: int) -> list[PDFChunk]:
        chunks = []
        start = 0
        idx   = 0
        while start < len(text):
            end  = start + CHUNK_SIZE
            chunk_text = text[start:end]
            if chunk_text.strip():
                chunks.append(PDFChunk(page=page, index=idx, text=chunk_text.strip()))
                idx += 1
            start = end - CHUNK_OVERLAP
        return chunks

    def retrieve(self, doc: PDFDocument, query: str, top_k: int = 8) -> list[PDFChunk]:
        query_terms = set(re.findall(r"\w+", query.lower()))
        if not query_terms:
            return doc.chunks[:top_k]

        scored: list[PDFChunk] = []
        for chunk in doc.chunks:
            chunk_words = re.findall(r"\w+", chunk.text.lower())
            chunk_set   = set(chunk_words)
            tf  = sum(chunk_words.count(t) for t in query_terms)
            cov = len(query_terms & chunk_set) / max(len(query_terms), 1)
            chunk.score = tf * 0.4 + cov * 0.6
            scored.append(chunk)
        scored.sort(key=lambda c: c.score, reverse=True)
        return scored[:top_k]

    def build_context(self, doc: PDFDocument, query: str) -> str:
        chunks = self.retrieve(doc, query)
        chunks.sort(key=lambda c: (c.page, c.index))
        parts = [f"[Tài liệu: {doc.filename} — {doc.total_pages} trang]\n"]
        total = len(parts[0])
        for chunk in chunks:
            snippet = f"\n--- Trang {chunk.page} ---\n{chunk.text}\n"
            if total + len(snippet) > MAX_CONTEXT:
                break
            parts.append(snippet)
            total += len(snippet)

        return "".join(parts)

    def exceeds_summary_scope(self, doc: PDFDocument) -> bool:
        """True if the document is too large to safely summarize whole in
        one bounded map-reduce pass (see FULL_SUMMARY_MAX_PAGES/CHARS)."""
        return doc.total_pages > FULL_SUMMARY_MAX_PAGES or doc.total_chars > FULL_SUMMARY_MAX_CHARS

    def map_chunks(self, doc: PDFDocument) -> list[str]:
        """Split doc.full_text into at most MAP_MAX_CHUNKS chunks, each
        normally at most MAP_CHUNK_CHARS chars, for the map step of bounded
        map-reduce summarization.

        NOTE: MAP_MAX_CHUNKS * MAP_CHUNK_CHARS (16 * 6,000 = 96,000) is
        slightly below FULL_SUMMARY_MAX_CHARS (100,000) — the plan's exact
        numbers don't multiply out evenly. Rather than silently dropping the
        tail of a document that legitimately passed exceeds_summary_scope()
        (which would resurrect the exact "truncate while claiming whole-
        document coverage" bug this task exists to fix, just at a narrower
        96k-100k boundary), the LAST allowed chunk absorbs whatever remains
        instead of being capped at MAP_CHUNK_CHARS. This only matters for
        documents in that narrow band; below 96,000 chars every chunk is a
        normal <=MAP_CHUNK_CHARS slice. Full text coverage is guaranteed for
        any document that passed exceeds_summary_scope()."""
        text = doc.full_text
        chunks: list[str] = []
        start = 0
        while start < len(text) and len(chunks) < MAP_MAX_CHUNKS:
            is_last_allowed_chunk = len(chunks) == MAP_MAX_CHUNKS - 1
            end = len(text) if is_last_allowed_chunk else start + MAP_CHUNK_CHARS
            chunk = text[start:end].strip()
            if chunk:
                chunks.append(chunk)
            start = end
        return chunks
