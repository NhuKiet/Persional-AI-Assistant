import asyncio
import logging
from pathlib import Path

from backend.app.core.config import settings
from backend.app.features.hmer.recognizer import (
    Explanation,
    HmerRecognizer,
    Recognition,
    RecognizerUnavailable,
    UnknownTokens,
)
from backend.app.features.hmer.repository import HmerRepository

__all__ = ["HmerService", "RecognizerUnavailable", "UnknownTokens"]

logger = logging.getLogger(__name__)

HMER_DIR = Path(settings.HMER_UPLOAD_DIR)


class HmerService:
    def __init__(
        self,
        recognizer: HmerRecognizer | None = None,
        repository: HmerRepository | None = None,
    ):
        self._recognizer = recognizer or HmerRecognizer()
        self._repository = repository or HmerRepository(HMER_DIR)
        # One model, one GPU: concurrent beam searches would compete for the
        # same VRAM that BGE reranker is already using on a 4GB card. Requests
        # queue instead of racing. Recognition takes seconds, not minutes, and
        # KiNg is a single-user assistant, so a queue is the right trade.
        self._lock = asyncio.Lock()

    def status(self) -> dict:
        return self._recognizer.status()

    def validate_filename(self, filename: str | None) -> str:
        return self._repository.validate_filename(filename)

    def list_images(self) -> list[dict]:
        return self._repository.list()

    def image_path(self, filename: str) -> Path:
        return self._repository.resolve(filename)

    def delete_image(self, filename: str) -> None:
        self._repository.delete(filename)

    async def recognize(self, filename: str, content: bytes) -> tuple[str, Recognition]:
        """Store the image, then recognize it.

        The image is saved before recognition so a crash mid-inference still
        leaves the input that caused it on disk.
        """
        path = self._repository.save(filename, content)

        async with self._lock:
            # Beam search is blocking CPU/GPU work. Running it inline would
            # stall the event loop for its whole duration, freezing every
            # other SSE stream in the process.
            recognition = await asyncio.to_thread(self._recognizer.recognize, content)

        logger.info(
            "HMER recognized %s in %dms on %s",
            path.name,
            recognition.elapsed_ms,
            recognition.device,
        )
        return path.name, recognition

    async def explain(self, filename: str, latex: str) -> Explanation:
        """Occlusion evidence for a stored image and the LaTeX it was read as.

        Stateless on purpose: the caller sends the LaTeX back rather than the
        service remembering it, so any (image, LaTeX) pair can be explained.

        Raises ValueError for a bad filename or empty LaTeX, FileNotFoundError
        for a missing image, UnknownTokens for tokens outside the vocabulary.
        """
        path = self._repository.resolve(filename)
        if not path.is_file():
            raise FileNotFoundError(filename)
        tokens = latex.split()
        if not tokens:
            raise ValueError("LaTeX rỗng — không có gì để giải thích")
        content = path.read_bytes()

        # Same lock as recognition: 65 forward passes on the same 4 GB GPU
        # must not overlap a beam search, or Windows pages VRAM to RAM.
        async with self._lock:
            explanation = await asyncio.to_thread(self._recognizer.explain, content, tokens)

        logger.info(
            "HMER explained %s (%d tokens) in %dms",
            path.name,
            len(tokens),
            explanation.elapsed_ms,
        )
        return explanation
