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
    has_data: bool = Field(
        description=(
            "True ONLY when the sources state at least two comparable numbers "
            "you can quote verbatim. False in every other case."
        )
    )
    type:     str  = Field(default="bar")
    title:    str  = Field(default="")
    labels:   list[str]   = Field(default_factory=list)
    values:   list[float] = Field(default_factory=list)
    unit:     str  = Field(default="")
    source_quote: str = Field(
        default="",
        description=(
            "The sentence(s) from the sources containing these numbers, copied "
            "VERBATIM. Checked against the sources; a chart whose quote is not "
            "found is discarded."
        ),
    )


class FollowUps(BaseModel):
    questions: list[str] = Field(description="4 follow-up research questions, each ending in '?'")


class ExtractedClaim(BaseModel):
    text:          str
    source_id:     int
    quote:         str = Field(
        default="",
        description=(
            "The sentence from the cited source that supports this claim, "
            "copied VERBATIM in the source's own language. Checked against "
            "the source text."
        ),
    )
    evidence_type: str = Field(description="one of: direct, inference, opinion, uncertain")


class Claims(BaseModel):
    claims: list[ExtractedClaim]
