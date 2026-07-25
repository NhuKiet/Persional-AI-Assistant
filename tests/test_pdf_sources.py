import asyncio

from backend.app.features.pdf.processor import PDFChunk
from backend.app.features.pdf.processor import PDFDocument
from backend.app.features.pdf.schemas import PDFChatRequest
from backend.app.features.pdf.service import PdfService
from backend.app.features.pdf.sources import serialize_sources


def test_serialize_sources_sorts_by_page_and_deduplicates_per_page():
    chunks = [
        PDFChunk(page=8, index=2, text="first relevant passage"),
        PDFChunk(page=3, index=0, text="second relevant passage"),
        PDFChunk(page=8, index=2, text="duplicate passage"),
    ]

    assert serialize_sources(chunks) == [
        {"page": 3, "chunk_index": 0, "excerpt": "second relevant passage"},
        {"page": 8, "chunk_index": 2, "excerpt": "first relevant passage"},
    ]


def test_serialize_sources_limits_count_and_excerpt_length():
    chunks = [PDFChunk(page=i + 1, index=0, text="x" * 240) for i in range(8)]
    sources = serialize_sources(chunks, limit=5, excerpt_chars=20)

    assert len(sources) == 5
    assert all(len(source["excerpt"]) <= 20 for source in sources)


def test_chat_emits_retrieved_sources_before_tokens(monkeypatch):
    chunks = [PDFChunk(page=4, index=1, text="authoritative excerpt")]
    document = PDFDocument("doc.pdf", total_pages=4, total_chars=21, chunks=chunks)
    service = PdfService()
    retrieve_calls = []

    monkeypatch.setattr(service, "_get_doc", lambda filename: document)

    def fake_retrieve(doc, query):
        retrieve_calls.append((doc, query))
        return chunks

    monkeypatch.setattr(service._processor, "retrieve", fake_retrieve)
    monkeypatch.setattr(service, "_stream_llm", lambda *args, **kwargs: iter(["answer"]))

    request = PDFChatRequest(message="question", filename="doc.pdf", session_id="s1")

    async def collect_events():
        return [event async for event in service.chat_events(request, "system")]

    events = asyncio.run(collect_events())

    assert len(retrieve_calls) == 1
    assert events[0] == {
        "type": "sources",
        "sources": [{"page": 4, "chunk_index": 1, "excerpt": "authoritative excerpt"}],
    }
    assert events[1] == {"type": "token", "content": "answer"}
    assert events[-1] == {"type": "done", "message": "ok"}
