import asyncio
import logging
from pathlib import Path

from backend.app.core.config import settings
from backend.app.features.hmer.recognizer import (
    HmerRecognizer,
    Recognition,
    RecognizerUnavailable,
)
from backend.app.features.hmer.repository import HmerRepository

__all__ = ["HmerService", "RecognizerUnavailable"]

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
