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


class StatusResponse(BaseModel):
    """Why recognition is or is not available, without sending an image."""

    configured: bool
    checkpoint: str | None
    checkpoint_exists: bool
    loaded: bool
    device: str | None
    last_error: str | None
