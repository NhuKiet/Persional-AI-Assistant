from pydantic import BaseModel


class ResearchRequest(BaseModel):
    query: str
    provider: str | None = None
    model: str | None = None


class DeepDiveRequest(BaseModel):
    question: str
    source_content: str
    source_meta: dict = {}
    provider: str | None = None
    model: str | None = None


class ResearchResponse(BaseModel):
    """Phản ánh đúng payload SSE 'done.data' hiện tại (10 khóa cũ + 3 khóa grounding)."""
    query: str
    summary_short: str = ""
    summary_medium: str = ""
    summary_detailed: str = ""
    key_points: list[str] = []
    comparison_table: list[dict] = []
    chart_data: dict | None = None
    papers: list[dict] = []
    references: list[dict] = []
    follow_up_questions: list[str] = []
    claims: list = []
    confidence: float | None = None
    limitations: list = []
