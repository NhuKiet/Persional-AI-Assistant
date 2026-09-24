import logging

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from backend.app.core.config import settings
from backend.app.features.hmer.schemas import (
    EvidenceMap,
    ExplainRequest,
    ExplainResponse,
    RecognizeResponse,
    StatusResponse,
)
from backend.app.features.hmer.service import HmerService, RecognizerUnavailable

logger = logging.getLogger(__name__)

router = APIRouter(tags=["hmer"])
_service = HmerService()

MAX_IMAGE_BYTES = settings.HMER_MAX_IMAGE_MB * 1024 * 1024


@router.get("/api/hmer/status", response_model=StatusResponse)
async def hmer_status():
    """Always 200, even when the model cannot serve.

    An operator checking why recognition is failing needs the reason in the
    body; a 503 here would just be a second thing to debug.
    """
    return _service.status()


@router.post("/api/hmer/recognize", response_model=RecognizeResponse)
async def recognize(file: UploadFile = File(...)):
    try:
        filename = _service.validate_filename(file.filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Reject on the declared size before materializing the upload, matching
    # the PDF upload path: an oversized file should not pay for a full read().
    if file.size is not None and file.size > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Ảnh quá lớn (tối đa {settings.HMER_MAX_IMAGE_MB}MB)",
        )

    content = await file.read()
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Ảnh quá lớn (tối đa {settings.HMER_MAX_IMAGE_MB}MB)",
        )
    if not content:
        raise HTTPException(status_code=400, detail="File rỗng")

    try:
        stored_name, recognition = await _service.recognize(filename, content)
    except RecognizerUnavailable as exc:
        # 503 with the operator-facing reason: a missing checkpoint or an
        # uninstalled package is a deployment state, not a bad request.
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("HMER recognition failed for %s", filename)
        raise HTTPException(
            status_code=500, detail=f"Nhận dạng thất bại: {exc}"
        ) from exc

    return RecognizeResponse(
        filename=stored_name,
        latex=recognition.latex,
        score=recognition.score,
        elapsed_ms=recognition.elapsed_ms,
        device=recognition.device,
    )


@router.post("/api/hmer/explain", response_model=ExplainResponse)
async def explain(request: ExplainRequest):
    """Which regions of the image each token of `latex` rests on.

    A separate call from recognize so the LaTeX never waits for the ~65
    extra forward passes this takes.
    """
    try:
        explanation = await _service.explain(request.filename, request.latex)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Không tìm thấy ảnh") from exc
    except ValueError as exc:
        # Bad filename, empty LaTeX, or tokens outside the vocabulary
        # (UnknownTokens is a ValueError): all things the caller can fix.
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RecognizerUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("HMER explanation failed for %s", request.filename)
        raise HTTPException(
            status_code=500, detail=f"Không tính được vùng mô hình dựa vào: {exc}"
        ) from exc

    return ExplainResponse(
        tokens=explanation.tokens,
        token_probs=explanation.token_probs,
        evidence=EvidenceMap(
            rows=explanation.rows,
            cols=explanation.cols,
            weights=explanation.weights,
            no_evidence=explanation.no_evidence,
        ),
        elapsed_ms=explanation.elapsed_ms,
    )


@router.get("/api/hmer/images")
async def list_images():
    return {"files": _service.list_images()}


@router.get("/api/hmer/images/{filename}")
async def get_image(filename: str):
    try:
        path = _service.image_path(filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Không tìm thấy ảnh")
    return FileResponse(path)


@router.delete("/api/hmer/images/{filename}")
async def delete_image(filename: str):
    try:
        _service.delete_image(filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"deleted": filename}
