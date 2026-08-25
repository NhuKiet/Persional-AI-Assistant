import asyncio

from fastapi import APIRouter, HTTPException, Query

from backend.app.core.config import settings
from backend.app.features.news import scheduler
from backend.app.features.news.schemas import NewsItemOut, NewsListResponse, RefreshResponse, Topic
from backend.app.features.news.store import _store

router = APIRouter(tags=["news"])


def _require_storage() -> None:
    if not settings.SUPABASE_DB_URL:
        raise HTTPException(status_code=503, detail="News storage chưa được cấu hình (SUPABASE_DB_URL).")


@router.get("/api/news", response_model=NewsListResponse)
async def list_news(
    topic: Topic | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    _require_storage()
    items, has_more = await asyncio.to_thread(
        _store.list_items, topic.value if topic else None, limit, offset,
    )
    return NewsListResponse(
        items=[NewsItemOut.from_news_item(i) for i in items],
        limit=limit, offset=offset, has_more=has_more,
    )


@router.post("/api/news/refresh", response_model=RefreshResponse)
async def refresh_now():
    _require_storage()
    elapsed = scheduler.seconds_since_last_refresh()
    if elapsed < settings.NEWS_MANUAL_COOLDOWN_SECONDS:
        remaining = int(settings.NEWS_MANUAL_COOLDOWN_SECONDS - elapsed)
        raise HTTPException(status_code=429, detail=f"Vừa mới cập nhật — thử lại sau {remaining}s.")
    result = await scheduler.refresh_news()
    return RefreshResponse(new_count=result.new_count)
