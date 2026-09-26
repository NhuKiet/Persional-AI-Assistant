"""PDF answers cite pages inline as [Tr.N], and every page the model saw has
a source to jump to. Opening a document suggests questions about it."""
import asyncio
import re

import pytest
from fastapi.testclient import TestClient

import backend.app.features.pdf.router as pdf_router
from backend.app.core.csrf import CLIENT_HEADER
from backend.app.features.pdf import prompts
from backend.app.features.pdf.processor import MAX_CONTEXT, PDFChunk, PDFDocument
from backend.app.features.pdf.schemas import PDFChatRequest
from backend.app.features.pdf.service import PdfService
from main import app


def _run_chat(service, document, chunks):
    sent = {}
    service._get_doc = lambda filename: document
    service._processor.retrieve = lambda doc, query: chunks

    def fake_stream(messages, system, **_kwargs):
        sent["content"], sent["system"] = messages[-1]["content"], system
        return iter(["ok"])

    service._stream_llm = fake_stream

    async def collect():
        request = PDFChatRequest(message="q", filename="doc.pdf", session_id="s1")
        return [e async for e in service.chat_events(request, prompts.PDF_SYSTEM)]

    events = asyncio.run(collect())
    sources = next(e["sources"] for e in events if e["type"] == "sources")
    return sources, sent


def _context_pages(content: str) -> set[int]:
    return {int(n) for n in re.findall(r"--- Trang (\d+) ---", content)}


# ── Page citations ──────────────────────────────────────────────────────────

def test_every_page_the_model_sees_has_a_source():
    # Seven pages retrieved: the old cap of five chips left two cited pages
    # with nowhere to jump.
    chunks = [PDFChunk(page=p, index=0, text=f"nội dung trang {p}", score=1.0 / p) for p in range(1, 8)]
    doc = PDFDocument("doc.pdf", total_pages=7, total_chars=200, chunks=chunks)

    sources, sent = _run_chat(PdfService(), doc, chunks)

    assert [s["page"] for s in sources] == [1, 2, 3, 4, 5, 6, 7]
    assert _context_pages(sent["content"]) == {s["page"] for s in sources}


def test_pages_cut_from_the_context_get_no_source():
    big = "x" * (MAX_CONTEXT // 2)
    chunks = [PDFChunk(page=p, index=0, text=big, score=1.0) for p in (2, 5, 9)]
    doc = PDFDocument("doc.pdf", total_pages=9, total_chars=3 * len(big), chunks=chunks)

    sources, sent = _run_chat(PdfService(), doc, chunks)

    assert {s["page"] for s in sources} == _context_pages(sent["content"])
    assert 9 not in {s["page"] for s in sources}


def test_a_page_s_excerpt_is_its_most_relevant_chunk():
    chunks = [
        PDFChunk(page=3, index=0, text="đoạn ít liên quan", score=0.1),
        PDFChunk(page=3, index=1, text="đoạn trả lời câu hỏi", score=0.9),
    ]
    doc = PDFDocument("doc.pdf", total_pages=3, total_chars=40, chunks=chunks)

    sources, _ = _run_chat(PdfService(), doc, chunks)

    assert sources == [{"page": 3, "chunk_index": 1, "excerpt": "đoạn trả lời câu hỏi"}]


def test_system_prompt_asks_for_bracketed_page_citations():
    assert "[Tr.12]" in prompts.PDF_SYSTEM


# ── Suggested questions ─────────────────────────────────────────────────────

@pytest.fixture
def suggest_env(monkeypatch):
    doc = PDFDocument(
        "bai-giang.pdf", total_pages=12, total_chars=900,
        chunks=[PDFChunk(page=p, index=0, text=f"Chương {p}: attention và transformer") for p in range(1, 13)],
        full_text="Bài giảng về transformer. " * 20,
    )
    service = PdfService()
    calls = []
    service._get_doc = lambda filename: doc if filename == "bai-giang.pdf" else (_ for _ in ()).throw(FileNotFoundError(filename))

    def fake_invoke(prompt, system, **kwargs):
        calls.append({"prompt": prompt, **kwargs})
        return "1. Self-attention khác RNN ở điểm nào?\n- Vì sao cần positional encoding?\n\n"\
               "3) Multi-head attention giúp gì?\nCâu hỏi 4: Độ phức tạp của attention là bao nhiêu?\n5. Thừa"

    service._invoke_llm = fake_invoke
    monkeypatch.setattr(pdf_router, "_service", service)
    return service, calls


def _suggest(**body):
    client = TestClient(app, headers={CLIENT_HEADER: "test"})
    return client.post("/api/pdf/suggestions", json={"filename": "bai-giang.pdf", **body})


def test_suggestions_are_four_clean_questions(suggest_env):
    response = _suggest()

    assert response.status_code == 200
    assert response.json() == {"questions": [
        "Self-attention khác RNN ở điểm nào?",
        "Vì sao cần positional encoding?",
        "Multi-head attention giúp gì?",
        "Độ phức tạp của attention là bao nhiêu?",
    ]}


def test_suggestions_read_from_across_the_document(suggest_env):
    _, calls = suggest_env
    _suggest()

    prompt = calls[0]["prompt"]
    assert "Chương 1" in prompt and "Chương 12" in prompt


def test_suggestions_are_generated_once_per_document(suggest_env):
    _, calls = suggest_env
    _suggest()
    _suggest()

    assert len(calls) == 1


def test_deleting_the_document_forgets_its_suggestions(suggest_env):
    _, calls = suggest_env
    client = TestClient(app, headers={CLIENT_HEADER: "test"})
    _suggest()
    client.delete("/api/pdf/file/bai-giang.pdf?session_id=s-del")
    _suggest()

    assert len(calls) == 2


def test_a_failed_llm_call_gives_no_suggestions_instead_of_an_error(suggest_env):
    service, calls = suggest_env

    def boom(*_a, **_k):
        raise RuntimeError("provider down")

    service._invoke_llm = boom

    response = _suggest()
    assert response.status_code == 200
    assert response.json() == {"questions": []}


def test_suggestions_for_a_missing_document_are_404(suggest_env):
    assert _suggest(filename="khong-co.pdf").status_code == 404


def test_suggestions_reject_bad_filenames(suggest_env):
    assert _suggest(filename="../../.env").status_code == 400
