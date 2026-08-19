"""Pydantic schemas for LLM structured output.

Separate from schemas.py, which holds the HTTP request/response models —
these never cross the API boundary, they only shape what the model returns.

The five-strategy JSON repair ladder in synthesizer._parse_obj is NOT
retired by these: Ollama/llama3 has no structured output, so that ladder
remains the fallback path.
"""
from pydantic import BaseModel, Field


class SummaryShortMedium(BaseModel):
    short:  str = Field(description="A 2-3 sentence summary of the main topic and key insight")
    medium: str = Field(description="A 2-paragraph overview of context, methods, and findings")


class KeyPoints(BaseModel):
    points: list[str] = Field(
        description=(
            "8 key findings. Each starts with exactly one tag: [FINDING] [METHOD] "
            "[DATA] [TREND] [LIMITATION] [DEFINITION], then at least 15 words."
        )
    )


class ComparisonRow(BaseModel):
    source:     str
    type:       str
    main_claim: str
    strength:   str
    limitation: str


class ComparisonTable(BaseModel):
    rows: list[ComparisonRow]


class ChartData(BaseModel):
    has_data: bool = Field(description="False when the sources contain no comparable numbers")
    type:     str  = Field(default="bar")
    title:    str  = Field(default="")
    labels:   list[str]   = Field(default_factory=list)
    values:   list[float] = Field(default_factory=list)
    unit:     str  = Field(default="")


class FollowUps(BaseModel):
    questions: list[str] = Field(description="4 follow-up research questions, each ending in '?'")


class ExtractedClaim(BaseModel):
    """Mirrors exactly what extract_claims already reads from the text path."""
    text:          str
    source_id:     int
    evidence_type: str = Field(description="one of: direct, inference, opinion, uncertain")


class Claims(BaseModel):
    claims: list[ExtractedClaim]
