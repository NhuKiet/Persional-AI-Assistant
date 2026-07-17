import logging

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

from backend.app.core.config import settings
from backend.app.features.coding.artifacts import ArtifactService, MIME_MAP
from backend.app.features.coding.schemas import CodingRequest
from backend.app.features.coding.service import CodingConversationManager, CodingService
from backend.app.features.coding.uploads import UploadService
from backend.app.shared.sse import sse


logger = logging.getLogger(__name__)

router = APIRouter(tags=["coding"])

_conv_manager = CodingConversationManager()
_service = CodingService(conversations=_conv_manager)
_uploads = UploadService()
_artifacts = ArtifactService()


@router.post("/api/coding/upload")
async def upload_file(file: UploadFile = File(...), session_id: str = Form("default")):
    return _uploads.save(session_id, file.filename or "", await file.read())


@router.delete("/api/coding/file/{filename}")
async def delete_file(filename: str, session_id: str = "default"):
    _uploads.delete(session_id, filename)
    return {"deleted": filename}


@router.post("/api/coding/stream")
async def coding_stream(req: CodingRequest):
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Message required")
    if len(req.message) > settings.MAX_MESSAGE_CHARS:
        raise HTTPException(status_code=413, detail=f"Message quá dài (giới hạn {settings.MAX_MESSAGE_CHARS} ký tự).")

    req.message = req.message.strip()

    async def generate():
        async for event in _service.stream(req):
            yield sse(event)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/api/coding/artifact/{session_id}/{filename}")
async def serve_session_artifact(session_id: str, filename: str):
    path = _artifacts.resolve(session_id, filename)
    return FileResponse(str(path), media_type=MIME_MAP.get(path.suffix.lower(), "application/octet-stream"))


@router.get("/api/coding/artifact/{filename}")
async def serve_artifact(filename: str):
    path = _artifacts.resolve_root(filename)
    return FileResponse(str(path), media_type=MIME_MAP.get(path.suffix.lower(), "application/octet-stream"))


@router.delete("/api/coding/session/{session_id}")
async def clear_coding_session(session_id: str):
    _conv_manager.clear_session(session_id)
    return {"cleared": session_id}


@router.get("/api/coding/session/{session_id}")
async def get_coding_session(session_id: str):
    return {"history": _conv_manager.get_history(session_id)}
