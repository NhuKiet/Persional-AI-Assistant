"""Proxy mỏng sang bridge server của ai-agent (dự án riêng, cùng máy, cổng
BRIDGE_URL) — cho chat bubble nổi trên web. Không chứa logic agent gì cả,
toàn bộ tool-calling/policy nằm bên ai-agent."""

import logging

import httpx
from fastapi import APIRouter, HTTPException

from backend.app.core.config import settings
from backend.app.features.assistant_bubble.schemas import BubbleChatRequest, BubbleChatResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["assistant-bubble"])

_BRIDGE_UNAVAILABLE = "Trợ lý cá nhân (ai-agent) hiện chưa chạy trên máy này."


def _headers() -> dict:
    return {"X-Bridge-Token": settings.BRIDGE_TOKEN or ""}


@router.post("/api/bubble/chat", response_model=BubbleChatResponse)
async def bubble_chat(req: BubbleChatRequest) -> BubbleChatResponse:
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            resp = await client.post(
                f"{settings.BRIDGE_URL}/bridge/chat",
                json={"message": req.message},
                headers=_headers(),
            )
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail=_BRIDGE_UNAVAILABLE)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Trợ lý cá nhân phản hồi quá lâu, thử lại nhé.")

    if resp.status_code == 401:
        logger.error("Bridge rejected token — BRIDGE_TOKEN không khớp giữa KiNg và ai-agent")
        raise HTTPException(status_code=503, detail=_BRIDGE_UNAVAILABLE)
    if resp.status_code == 409:
        raise HTTPException(status_code=409, detail="Trợ lý đang xử lý yêu cầu trước đó, đợi chút nhé.")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=_BRIDGE_UNAVAILABLE)

    data = resp.json()
    return BubbleChatResponse(reply=data.get("reply", ""), images=data.get("images", []))


@router.post("/api/bubble/reset")
async def bubble_reset() -> dict:
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(f"{settings.BRIDGE_URL}/bridge/reset", headers=_headers())
    except (httpx.ConnectError, httpx.TimeoutException):
        raise HTTPException(status_code=503, detail=_BRIDGE_UNAVAILABLE)

    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=_BRIDGE_UNAVAILABLE)
    return {"cleared": True}
