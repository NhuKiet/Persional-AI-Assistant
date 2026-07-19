from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str
    session_id: str = "default"
    tool: str = "chat"
    context: str = ""
    provider: str | None = None
    model: str | None = None


class SessionHistoryResponse(BaseModel):
    """Response shape for GET /api/<feature>/sessions/{session_id}."""

    session_id: str
    feature: str
    revision: int
    messages: list[dict]
