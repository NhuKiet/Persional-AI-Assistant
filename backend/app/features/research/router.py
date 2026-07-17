import json
import os

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse

from backend.app.features.research.schemas import DeepDiveRequest, ResearchRequest
from backend.app.features.research.service import ResearchService

router = APIRouter(tags=["research"])

DEEP_DIVE_SYSTEM = (
    "You are KiNg, a research assistant. Answer the user's question using ONLY "
    "the provided source. Be specific and cite figures/methods from the source. "
    "If the source does not contain the answer, say so plainly. "
    "Respond in Vietnamese by default; if the question is in English, respond in English. "
    "Use clean markdown."
)

_service: ResearchService | None = None


def get_service() -> ResearchService:
    global _service
    if _service is None:
        _service = ResearchService()
    return _service


def sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/api/research/stream")
async def research_stream(req: ResearchRequest):
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="Query required")

    async def generate():
        async for event in get_service().stream_events(req):
            yield sse(event)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/api/research/deep-dive")
async def deep_dive(req: DeepDiveRequest):
    """Answer a follow-up question grounded in a single source (SSE streaming)."""
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question required")

    async def generate():
        async for event in get_service().deep_dive_events(req, DEEP_DIVE_SYSTEM):
            yield sse(event)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/api/paper/{filename}")
async def serve_paper(filename: str):
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = f"data/papers/{filename}"
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Paper not found")
    return FileResponse(path, media_type="application/pdf")


@router.delete("/api/research/cache")
async def clear_research_cache():
    """Clear the research query cache (forces re-search on next request)."""
    get_service().clear_cache()
    return {"cleared": True, "message": "Research cache cleared"}
