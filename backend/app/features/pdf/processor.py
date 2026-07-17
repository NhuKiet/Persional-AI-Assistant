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

__all__ = ["PDF_DIR", "PDFChunk", "PDFDocument", "PDFProcessor"]


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
        chunks: list[PDFChunk] = []
        total_chars = 0

        for page_num, page in enumerate(doc, start=1):
            text = page.get_text("text")
            text = self._clean_text(text)
            if not text.strip():
                continue

            total_chars += len(text)
            page_chunks = self._chunk_text(text, page_num)
            chunks.extend(page_chunks)

        doc.close()
        logger.info(f"Extracted {len(chunks)} chunks from {filename} ({total_chars} chars)")

        return PDFDocument(
            filename=filename,
            total_pages=page_num if chunks else 0,
            total_chars=total_chars,
            chunks=chunks,
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

    def summary_context(self, doc: PDFDocument, max_chars: int = 3000) -> str:
        all_text = "\n".join(c.text for c in doc.chunks)
        return f"[{doc.filename} — {doc.total_pages} trang, {doc.total_chars} ký tự]\n\n{all_text[:max_chars]}"
