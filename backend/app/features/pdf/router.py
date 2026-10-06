import asyncio
import logging
import secrets
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from backend.app.core.auth import guest_model, is_guest
from backend.app.core.config import settings
from backend.app.core.rate_limit import rate_limit
from backend.app.features.pdf.processor import PDF_DIR, PDFProcessor
from backend.app.features.pdf.repository import PdfRepository
from backend.app.features.pdf.schemas import (
    PDFChatRequest,
    PDFSuggestRequest,
    PDFSuggestResponse,
    PDFSummarizeRequest,
    SessionHistoryResponse,
)
from backend.app.features.pdf.prompts import PDF_SYSTEM, SUMMARY_SYSTEM
from backend.app.features.pdf.service import PdfService, SessionBusyError
from backend.app.shared.conversation_store import ConversationManager
from backend.app.shared.files import prune_oldest
from backend.app.shared.guest_store import guest_sessions
from backend.app.shared.session_locks import log_concurrent_rejection
from backend.app.shared.latency import timed
from backend.app.shared.model_guard import require_allowed_model
from backend.app.shared.sse import LeasedStreamingResponse, sse


logger = logging.getLogger(__name__)

router = APIRouter(tags=["pdf"])
_repository = PdfRepository(PDF_DIR)
_service = PdfService()

# How many guest uploads to keep; older ones are deleted on the next upload.
GUEST_MAX_FILES = 50


class PdfSpace:
    """Where a guest's PDFs live: their own folder (not listed, not reachable
    by the owner's routes and vice versa), their own parsed-document cache,
    and chat history in memory only."""

    def __init__(self, directory: Path, guest: bool = True):
        self.repository = PdfRepository(directory)
        conversations = ConversationManager(namespace="guest-pdf", store=guest_sessions) if guest else None
        self.service = PdfService(processor=PDFProcessor(directory), conversations=conversations)


_guest = PdfSpace(PDF_DIR / "guest")


def _space(request: Request) -> tuple[PdfRepository, PdfService]:
    if is_guest(request):
        return _guest.repository, _guest.service
    return _repository, _service


def _check_filename(filename: str | None) -> str:
    try:
        return _repository.validate_filename(filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


MAX_PDF_BYTES = 50 * 1024 * 1024


@router.post("/api/pdf/upload")
async def upload_pdf(request: Request, file: UploadFile = File(...)):
    filename = _check_filename(file.filename)
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Chỉ chấp nhận file PDF (.pdf)")
    guest = is_guest(request)
    repository, service = _space(request)
    max_mb = settings.GUEST_MAX_UPLOAD_MB if guest else MAX_PDF_BYTES // (1024 * 1024)
    max_bytes = max_mb * 1024 * 1024
    too_big = f"File quá lớn (tối đa {max_mb}MB)"

    # Reject on the declared size (known once multipart parsing finishes)
    # BEFORE materializing the whole upload into an in-memory bytes object —
    # an oversized file should never pay for a full read() just to be thrown away.
    if file.size is not None and file.size > max_bytes:
        raise HTTPException(status_code=400, detail=too_big)

    content = await file.read()
    if len(content) > max_bytes:
        raise HTTPException(status_code=400, detail=too_big)
    if guest:
        # Guests share one folder: an unguessable prefix keeps one guest from
        # opening (or overwriting) another's file by name.
        filename = f"{secrets.token_hex(8)}_{filename}"

    # Writing up to 50 MB and parsing it with PyMuPDF are both blocking —
    # run them on a worker thread, not the event loop.
    destination = await asyncio.to_thread(repository.save, filename, content)
    try:
        document = await asyncio.to_thread(service._processor.extract, filename)
        # Same name, possibly new content: forget suggestions for the old one.
        service.forget_document(filename)
        service._doc_cache[filename] = document
        if guest:
            for old in await asyncio.to_thread(prune_oldest, destination.parent, "*.pdf", GUEST_MAX_FILES):
                service.forget_document(old.name)
        return {
            "filename": filename,
            "size": len(content),
            "total_pages": document.total_pages,
            "total_chars": document.total_chars,
            "chunks": len(document.chunks),
        }
    except Exception as exc:
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Lỗi đọc PDF: {str(exc)}") from exc


@router.get("/api/pdf/list")
async def list_pdfs():
    return {"files": _repository.list(_service._doc_cache)}


@router.get("/api/pdf/raw/{filename}")
async def raw_pdf(filename: str, request: Request):
    repository, _ = _space(request)
    path = repository.resolve(_check_filename(filename))
    if not path.exists():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(str(path), media_type="application/pdf")


# Plain `def`, not `async def`: the history store is synchronous psycopg, so
# FastAPI must run this on its threadpool (tests/test_event_loop_blocking.py).
@router.delete("/api/pdf/file/{filename}")
def delete_pdf(filename: str, request: Request, session_id: str = "default"):
    filename = _check_filename(filename)
    repository, service = _space(request)
    if is_guest(request) and not repository.resolve(filename).exists():
        raise HTTPException(status_code=404, detail="Not found")
    repository.delete(filename)
    service.forget_document(filename)
    # Conversation history is keyed by session_id, NOT filename — two
    # sessions can open the same filename, and clearing by filename would
    # wipe the other session's chat history.
    service._conv_manager.clear_session(session_id)
    return {"deleted": filename}


@router.post("/api/pdf/stream", dependencies=[Depends(rate_limit("expensive"))])
async def pdf_chat_stream(request: PDFChatRequest, http: Request):
    _, service = _space(http)
    if is_guest(http):
        request.provider, request.model = guest_model()
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Message required")
    if len(request.message) > settings.MAX_MESSAGE_CHARS:
        raise HTTPException(
            status_code=413,
            detail=f"Message quá dài (giới hạn {settings.MAX_MESSAGE_CHARS} ký tự).",
        )
    _check_filename(request.filename)
    require_allowed_model(request.provider, request.model)

    try:
        lock = service.begin_session(request.session_id)
    except SessionBusyError:
        log_concurrent_rejection(logger, "pdf", request.session_id)
        return JSONResponse(status_code=409, content={"detail": "session_busy"})

    async def generate():
        try:
            async for event in timed("pdf", service.chat_events(request, PDF_SYSTEM)):
                yield sse(event)
        finally:
            service.end_session(lock)

    return LeasedStreamingResponse(
        generate(),
        lease=lock,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post(
    "/api/pdf/suggestions",
    response_model=PDFSuggestResponse,
    dependencies=[Depends(rate_limit("expensive"))],
)
async def pdf_suggestions(request: PDFSuggestRequest):
    """Questions about this document for the empty chat panel — one LLM
    call per file, then cached until the file is deleted or re-uploaded."""
    _check_filename(request.filename)
    require_allowed_model(request.provider, request.model)
    try:
        questions = await asyncio.to_thread(
            _service.suggest_questions, request.filename, request.provider, request.model,
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài liệu") from None
    return PDFSuggestResponse(questions=questions)


@router.post("/api/pdf/summarize", dependencies=[Depends(rate_limit("expensive"))])
async def pdf_summarize(request: PDFSummarizeRequest, http: Request):
    _, service = _space(http)
    if is_guest(http):
        request.provider, request.model = guest_model()
    _check_filename(request.filename)
    require_allowed_model(request.provider, request.model)

    try:
        lock = service.begin_session(request.session_id)
    except SessionBusyError:
        log_concurrent_rejection(logger, "pdf", request.session_id)
        return JSONResponse(status_code=409, content={"detail": "session_busy"})

    async def generate():
        try:
            async for event in timed("pdf_summary", service.summarize_events(request, SUMMARY_SYSTEM)):
                yield sse(event)
        finally:
            service.end_session(lock)

    return LeasedStreamingResponse(
        generate(),
        lease=lock,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/api/pdf/sessions/{session_id}", response_model=SessionHistoryResponse)
def get_pdf_session_history(session_id: str):
    """Read-only session history restore. Never touches the session lock."""
    messages, revision = _service._conv_manager.get_history_with_revision(session_id)
    if not messages:
        raise HTTPException(status_code=404, detail="session_not_found")
    return SessionHistoryResponse(
        session_id=session_id, feature="pdf", revision=revision, messages=messages
    )
