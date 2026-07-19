from pydantic import BaseModel


class PDFChatRequest(BaseModel):
    message: str
    filename: str
    session_id: str = "default"
    provider: str | None = None
    model: str | None = None
    pins: list[dict] = []


class PDFSummarizeRequest(BaseModel):
    filename: str
    session_id: str = "default"
    provider: str | None = None
    model: str | None = None


class SessionHistoryResponse(BaseModel):
    """Response shape for GET /api/<feature>/sessions/{session_id}."""

    session_id: str
    feature: str
    revision: int
    messages: list[dict]
