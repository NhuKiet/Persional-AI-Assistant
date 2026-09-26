from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str
    session_id: str = "default"
    tool: str = "chat"
    context: str = ""
    provider: str | None = None
    model: str | None = None
    # Answer again instead of appending: the session's last exchange is left
    # out of the context and replaced once the new answer exists. Regenerate
    # sends the same message, edit-last sends the edited one.
    replace_last: bool = False


class SessionHistoryResponse(BaseModel):
    """Response shape for GET /api/<feature>/sessions/{session_id}."""

    session_id: str
    feature: str
    revision: int
    messages: list[dict]
