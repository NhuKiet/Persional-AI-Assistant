import logging

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

from backend.app.core.config import settings
from backend.app.features.pdf.processor import PDF_DIR
from backend.app.features.pdf.repository import PdfRepository
from backend.app.features.pdf.schemas import PDFChatRequest, PDFSummarizeRequest, SessionHistoryResponse
from backend.app.features.pdf.prompts import PDF_SYSTEM, SUMMARY_SYSTEM
from backend.app.features.pdf.service import PdfService, SessionBusyError
from backend.app.shared.session_locks import log_concurrent_rejection
from backend.app.shared.sse import sse


logger = logging.getLogger(__name__)

router = APIRouter(tags=["pdf"])
_repository = PdfRepository(PDF_DIR)
_service = PdfService()


def _check_filename(filename: str | None) -> str:
    try:
        return _repository.validate_filename(filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


MAX_PDF_BYTES = 50 * 1024 * 1024


@router.post("/api/pdf/upload")
async def upload_pdf(file: UploadFile = File(...)):
    filename = _check_filename(file.filename)
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Chỉ chấp nhận file PDF (.pdf)")

    # Reject on the declared size (known once multipart parsing finishes)
    # BEFORE materializing the whole upload into an in-memory bytes object —
    # an oversized file should never pay for a full read() just to be thrown away.
    if file.size is not None and file.size > MAX_PDF_BYTES:
        raise HTTPException(status_code=400, detail="File quá lớn (tối đa 50MB)")

    content = await file.read()
    if len(content) > MAX_PDF_BYTES:
        raise HTTPException(status_code=400, detail="File quá lớn (tối đa 50MB)")

    destination = _repository.save(filename, content)
    try:
        document = _service._processor.extract(filename)
        _service._doc_cache[filename] = document
        return {
            "filename": filename,
            "size": len(content),
            "total_pages": document.total_pages,
            "total_chars": document.total_chars,
            "chunks": len(document.chunks),
        }
    except Exception as exc:
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Lỗi đọc PDF: {str(exc)}")


@router.get("/api/pdf/list")
async def list_pdfs():
    return {"files": _repository.list(_service._doc_cache)}


@router.get("/api/pdf/raw/{filename}")
async def raw_pdf(filename: str):
    path = _repository.resolve(_check_filename(filename))
    if not path.exists():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(str(path), media_type="application/pdf")


@router.delete("/api/pdf/file/{filename}")
async def delete_pdf(filename: str, session_id: str = "default"):
    filename = _check_filename(filename)
    _repository.delete(filename)
    _service._doc_cache.pop(filename, None)
    # Conversation history is keyed by session_id, NOT filename — two
    # sessions can open the same filename, and clearing by filename would
    # wipe the other session's chat history.
    _service._conv_manager.clear_session(session_id)
    return {"deleted": filename}


@router.post("/api/pdf/stream")
async def pdf_chat_stream(request: PDFChatRequest):
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Message required")
    if len(request.message) > settings.MAX_MESSAGE_CHARS:
        raise HTTPException(
            status_code=413,
            detail=f"Message quá dài (giới hạn {settings.MAX_MESSAGE_CHARS} ký tự).",
        )
    _check_filename(request.filename)

    try:
        lock = _service.begin_session(request.session_id)
    except SessionBusyError:
        log_concurrent_rejection(logger, "pdf", request.session_id)
        return JSONResponse(status_code=409, content={"detail": "session_busy"})

    async def generate():
        try:
            async for event in _service.chat_events(request, PDF_SYSTEM):
                yield sse(event)
        finally:
            _service.end_session(lock)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/api/pdf/summarize")
async def pdf_summarize(request: PDFSummarizeRequest):
    _check_filename(request.filename)

    try:
        lock = _service.begin_session(request.session_id)
    except SessionBusyError:
        log_concurrent_rejection(logger, "pdf", request.session_id)
        return JSONResponse(status_code=409, content={"detail": "session_busy"})

    async def generate():
        try:
            async for event in _service.summarize_events(request, SUMMARY_SYSTEM):
                yield sse(event)
        finally:
            _service.end_session(lock)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/api/pdf/sessions/{session_id}", response_model=SessionHistoryResponse)
async def get_pdf_session_history(session_id: str):
    """Read-only session history restore. Never touches the session lock."""
    messages, revision = _service._conv_manager.get_history_with_revision(session_id)
    if not messages:
        raise HTTPException(status_code=404, detail="session_not_found")
    return SessionHistoryResponse(
        session_id=session_id, feature="pdf", revision=revision, messages=messages
    )
