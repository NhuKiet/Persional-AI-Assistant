from pydantic import BaseModel


class RecognizeResponse(BaseModel):
    """Result of one expression image.

    `latex` is space-separated tokens as the vocabulary emits them, which is
    what MathJax/KaTeX expect. An empty string means the model ran and
    produced no hypothesis — distinct from an error, which never reaches here.
    """

    filename: str
    latex: str
    score: float
    elapsed_ms: int
    device: str


class ExplainRequest(BaseModel):
    """A stored image and the LaTeX to explain, as recognize returned it."""

    filename: str
    latex: str


class EvidenceMap(BaseModel):
    """Occlusion evidence over a rows × cols grid of the uploaded image.

    Cell (r, c) covers [c/cols, (c+1)/cols] × [r/rows, (r+1)/rows] of the
    image, since the model's resize is a pure scale. weights[i] sums to 1, or
    is all zero when no_evidence[i]: hiding any single cell barely moved the
    model's belief in token i.
    """

    rows: int
    cols: int
    weights: list[list[float]]
    no_evidence: list[bool]


class ExplainResponse(BaseModel):
    tokens: list[str]
    token_probs: list[float]
    evidence: EvidenceMap
    elapsed_ms: int


class StatusResponse(BaseModel):
    """Why recognition is or is not available, without sending an image."""

    configured: bool
    checkpoint: str | None
    checkpoint_exists: bool
    loaded: bool
    device: str | None
    last_error: str | None
