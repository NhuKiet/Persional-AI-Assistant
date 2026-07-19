from pydantic import BaseModel


class CodingRequest(BaseModel):
    message: str
    session_id: str = "default"
    chat_only: bool = False
    uploaded_files: list[dict] = []
    provider: str | None = None
    model: str | None = None


class SessionHistoryResponse(BaseModel):
    """Response shape for GET /api/<feature>/sessions/{session_id}."""

    session_id: str
    feature: str
    revision: int
    messages: list[dict]
