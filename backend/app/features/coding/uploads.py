import json
import logging
import re
from pathlib import Path

from fastapi import HTTPException

from backend.app.core.config import settings
from backend.app.features.coding.data_preview import table_preview
from backend.app.features.coding.execution import SANDBOX_DIR
from backend.app.shared.files import contained_path


logger = logging.getLogger(__name__)

UPLOAD_EXTS = {
    ".csv", ".json", ".jsonl", ".xlsx", ".xls",
    ".txt", ".tsv", ".parquet", ".xml",
}


def session_sandbox(session_id: str) -> Path:
    safe = re.sub(r"[^a-zA-Z0-9_\-]", "_", session_id)[:64]
    path = (SANDBOX_DIR / safe).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


class UploadService:
    def save(self, session_id: str, filename: str, content: bytes) -> dict:
        """Blocking (file write + parsing a table of up to MAX_UPLOAD_MB):
        async callers go through a worker thread."""
        destination = self._resolve(session_id, filename)

        suffix = Path(filename).suffix.lower()
        if suffix not in UPLOAD_EXTS:
            raise HTTPException(
                status_code=400,
                detail=f"File type '{suffix}' not supported. Allowed: {', '.join(sorted(UPLOAD_EXTS))}",
            )

        max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
        if len(content) > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"File quá lớn ({len(content) // (1024*1024)}MB). Giới hạn {settings.MAX_UPLOAD_MB}MB.",
            )

        destination.write_bytes(content)
        # No host path in the response: the browser never needs it, and the
        # code runs in the container's working directory, not at that path.
        return {
            "name": filename,
            "size": len(content),
            "preview": self._preview(suffix, content),
            "table": table_preview(suffix, content),
        }

    def delete(self, session_id: str, filename: str) -> None:
        path = self._resolve(session_id, filename)
        if path.exists():
            path.unlink()

    @staticmethod
    def _resolve(session_id: str, filename: str) -> Path:
        try:
            return contained_path(session_sandbox(session_id), filename)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid filename") from None

    @staticmethod
    def _preview(suffix: str, content: bytes) -> str:
        try:
            if suffix in (".csv", ".tsv", ".txt"):
                return "\n".join(content.decode("utf-8", errors="replace").splitlines()[:5])
            if suffix == ".json":
                return json.dumps(json.loads(content), ensure_ascii=False)[:300]
            if suffix == ".jsonl":
                return "\n".join(content.decode("utf-8", errors="replace").splitlines()[:3])
        except Exception as exc:
            logger.warning("Preview failed: %s", exc)
        return ""
