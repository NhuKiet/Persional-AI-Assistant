from datetime import datetime
from enum import Enum

from pydantic import BaseModel

from backend.app.features.news.models import NewsItem


class Topic(str, Enum):
    MODEL_RELEASE = "model_release"
    RESEARCH = "research"
    ROBOTICS = "robotics"
    COMMUNITY = "community"


class NewsItemOut(BaseModel):
    url: str
    title: str
    title_vi: str
    summary_vi: str
    source: str
    topic: str
    published_at: datetime | None
    fetched_at: datetime

    @classmethod
    def from_news_item(cls, item: NewsItem) -> "NewsItemOut":
        return cls(
            url=item.url, title=item.title, title_vi=item.title_vi,
            summary_vi=item.summary_vi, source=item.source, topic=item.topic,
            published_at=item.published_at, fetched_at=item.fetched_at,
        )


class NewsListResponse(BaseModel):
    items: list[NewsItemOut]
    limit: int
    offset: int
    has_more: bool


class RefreshResponse(BaseModel):
    new_count: int
