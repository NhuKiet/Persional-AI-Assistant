from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str
    session_id: str = "default"
    tool: str = "chat"
    context: str = ""
    provider: str | None = None
    model: str | None = None
