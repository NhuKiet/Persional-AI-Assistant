import asyncio

import pytest

from backend.app.features.pdf.repository import PdfRepository


def test_repository_rejects_path_traversal(tmp_path):
    repository = PdfRepository(tmp_path)

    with pytest.raises(ValueError):
        repository.resolve("../secrets.pdf")


# ─────────────────────────────────────────────────────────────────────────────
# Page count must survive image-only PDFs (no extractable text)
# ─────────────────────────────────────────────────────────────────────────────

def _make_image_only_pdf(path) -> None:
    """A real single-page PDF whose only content is an embedded raster image
    — get_text() returns "" for it, but it unambiguously has 1 page."""
    import fitz

    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 10, 10))
    pix.set_rect(pix.irect, (255, 0, 0))
    png_bytes = pix.tobytes("png")

    doc = fitz.open()
    page = doc.new_page()
    page.insert_image(fitz.Rect(10, 10, 100, 100), stream=png_bytes)
    doc.save(str(path))
    doc.close()


def test_extract_reports_page_count_for_image_only_pdf(tmp_path, monkeypatch):
    from backend.app.features.pdf import processor as processor_mod

    monkeypatch.setattr(processor_mod, "PDF_DIR", tmp_path)
    filename = "image_only.pdf"
    _make_image_only_pdf(tmp_path / filename)

    document = processor_mod.PDFProcessor().extract(filename)

    assert document.total_pages == 1      # page count survives despite no extractable text
    assert document.chunks == []          # RAG chunking correctly finds nothing to chunk
    assert document.total_chars == 0


# ─────────────────────────────────────────────────────────────────────────────
# Bounded map-reduce chunking for full-document summaries
# ─────────────────────────────────────────────────────────────────────────────

def test_map_chunks_bounded_to_16_chunks_of_at_most_6000_chars():
    """Below the 96,000-char clean-multiple boundary, every chunk is a
    normal <=6000-char slice and the count never exceeds 16."""
    from backend.app.features.pdf.processor import PDFDocument, PDFProcessor

    text = "a" * 90_000   # 15 clean 6,000-char chunks, well within scope
    doc = PDFDocument(filename="f.pdf", total_pages=1, total_chars=len(text), full_text=text)

    chunks = PDFProcessor().map_chunks(doc)

    assert len(chunks) <= 16
    assert all(len(c) <= 6000 for c in chunks)
    assert "".join(chunks) == text


def test_map_chunks_covers_full_text_at_96k_to_100k_char_boundary():
    """MAP_MAX_CHUNKS * MAP_CHUNK_CHARS (16 * 6,000 = 96,000) is slightly
    below FULL_SUMMARY_MAX_CHARS (100,000) — a document in that narrow band
    passes exceeds_summary_scope() as "in scope, summarize the whole thing"
    but doesn't fit cleanly into 16 chunks of 6,000 chars. map_chunks must
    never silently drop that tail — the last allowed chunk absorbs the
    remainder instead — otherwise the reduce step would claim full-document
    coverage while actually summarizing a truncated excerpt."""
    from backend.app.features.pdf.processor import PDFDocument, PDFProcessor

    text = "b" * 98_000   # in the 96,001–100,000 gap
    doc = PDFDocument(filename="f.pdf", total_pages=10, total_chars=len(text), full_text=text)
    proc = PDFProcessor()

    assert proc.exceeds_summary_scope(doc) is False   # genuinely "in scope" per the stated limits

    chunks = proc.map_chunks(doc)

    assert len(chunks) <= 16
    assert "".join(chunks) == text   # nothing silently dropped past the 16th chunk


def test_exceeds_summary_scope_over_page_limit():
    from backend.app.features.pdf.processor import PDFDocument, PDFProcessor

    doc = PDFDocument(filename="f.pdf", total_pages=101, total_chars=1000, full_text="x")
    assert PDFProcessor().exceeds_summary_scope(doc) is True


def test_exceeds_summary_scope_over_char_limit():
    from backend.app.features.pdf.processor import PDFDocument, PDFProcessor

    doc = PDFDocument(filename="f.pdf", total_pages=5, total_chars=100_001, full_text="x" * 100_001)
    assert PDFProcessor().exceeds_summary_scope(doc) is True


def test_exceeds_summary_scope_within_limits_is_false():
    from backend.app.features.pdf.processor import PDFDocument, PDFProcessor

    doc = PDFDocument(filename="f.pdf", total_pages=100, total_chars=100_000, full_text="x" * 100_000)
    assert PDFProcessor().exceeds_summary_scope(doc) is False


# ─────────────────────────────────────────────────────────────────────────────
# Summary scope rejection wired through the service (101 pages / 100,001 chars)
# ─────────────────────────────────────────────────────────────────────────────

def _summarize_events(svc, request):
    from backend.app.features.pdf.router import SUMMARY_SYSTEM

    async def _collect():
        return [ev async for ev in svc.summarize_events(request, SUMMARY_SYSTEM)]

    return asyncio.run(_collect())


def test_summarize_rejects_document_over_101_pages(monkeypatch):
    from backend.app.features.pdf.processor import PDFDocument
    from backend.app.features.pdf.schemas import PDFSummarizeRequest
    from backend.app.features.pdf.service import PdfService

    svc = PdfService()
    big_doc = PDFDocument(filename="big.pdf", total_pages=101, total_chars=1000, full_text="x" * 1000)
    monkeypatch.setattr(svc, "_get_doc", lambda filename: big_doc)

    monkeypatch.setattr(svc, "_stream_llm", lambda *a, **k: (_ for _ in ()).throw(
        AssertionError("must not call the LLM for an over-scope document")))

    events = _summarize_events(svc, PDFSummarizeRequest(filename="big.pdf"))

    types = [e["type"] for e in events]
    assert "pdf.summary_scope_rejected" in types
    rejected = next(e for e in events if e["type"] == "pdf.summary_scope_rejected")
    msg = rejected["message"].lower()
    assert "trang" in msg and "câu hỏi" in msg   # tells the user the actual escape hatches
    assert "đã tóm tắt" not in msg               # must never claim the summary happened


def test_summarize_rejects_document_over_100001_chars(monkeypatch):
    from backend.app.features.pdf.processor import PDFDocument
    from backend.app.features.pdf.schemas import PDFSummarizeRequest
    from backend.app.features.pdf.service import PdfService

    svc = PdfService()
    big_doc = PDFDocument(
        filename="big.pdf", total_pages=5, total_chars=100_001, full_text="x" * 100_001,
    )
    monkeypatch.setattr(svc, "_get_doc", lambda filename: big_doc)
    monkeypatch.setattr(svc, "_stream_llm", lambda *a, **k: (_ for _ in ()).throw(
        AssertionError("must not call the LLM for an over-scope document")))

    events = _summarize_events(svc, PDFSummarizeRequest(filename="big.pdf"))

    assert any(e["type"] == "pdf.summary_scope_rejected" for e in events)


# ─────────────────────────────────────────────────────────────────────────────
# Map-reduce respects the exact per-map and reduce-input limits
# ─────────────────────────────────────────────────────────────────────────────

def test_map_summarize_truncates_output_to_800_chars(monkeypatch):
    from backend.app.features.pdf import service as pdf_service_mod
    from backend.app.features.pdf.processor import MAP_OUTPUT_CHARS
    from backend.app.features.pdf.schemas import PDFSummarizeRequest
    from backend.app.features.pdf.service import PdfService

    monkeypatch.setattr(pdf_service_mod, "invoke_chat", lambda *a, **k: "X" * 5000)
    svc = PdfService()
    request = PDFSummarizeRequest(filename="f.pdf")

    result = svc._map_summarize("some chunk of document text", request, "SYS")

    assert len(result) == MAP_OUTPUT_CHARS


def test_summarize_reduce_input_bounded_by_map_output_limits(monkeypatch):
    from backend.app.features.pdf import service as pdf_service_mod
    from backend.app.features.pdf.processor import MAP_CHUNK_CHARS, MAP_OUTPUT_CHARS, PDFDocument
    from backend.app.features.pdf.schemas import PDFSummarizeRequest
    from backend.app.features.pdf.service import PdfService

    svc = PdfService()
    text = "w" * (MAP_CHUNK_CHARS * 3)   # exactly 3 map chunks
    doc = PDFDocument(filename="small.pdf", total_pages=3, total_chars=len(text), full_text=text)
    monkeypatch.setattr(svc, "_get_doc", lambda filename: doc)
    monkeypatch.setattr(pdf_service_mod, "invoke_chat", lambda *a, **k: "S" * (MAP_OUTPUT_CHARS + 500))

    captured = {}

    def fake_stream_llm(messages, system, provider=None, model=None):
        captured["reduce_prompt"] = messages[0]["content"]
        yield "final-summary"

    monkeypatch.setattr(svc, "_stream_llm", fake_stream_llm)

    events = _summarize_events(svc, PDFSummarizeRequest(filename="small.pdf"))

    # 3 chunks, each truncated to MAP_OUTPUT_CHARS before being folded into the reduce prompt
    assert captured["reduce_prompt"].count("S") == 3 * MAP_OUTPUT_CHARS
    tokens = [e for e in events if e["type"] == "token"]
    assert "".join(t["content"] for t in tokens) == "final-summary"
    assert any(e["type"] == "done" for e in events)
