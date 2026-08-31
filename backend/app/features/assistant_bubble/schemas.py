from pydantic import BaseModel


class BubbleChatRequest(BaseModel):
    message: str


class BubbleChatResponse(BaseModel):
    reply: str
    images: list[str] = []
