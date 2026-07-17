import json
import logging
import re
from pathlib import Path

from fastapi import HTTPException

from backend.app.core.config import settings
from backend.app.features.coding.execution import SANDBOX_DIR


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
        if not filename or "/" in filename or "\\" in filename or ".." in filename:
            raise HTTPException(status_code=400, detail="Invalid filename")

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

        destination = session_sandbox(session_id) / filename
        destination.write_bytes(content)
        return {"name": filename, "size": len(content), "preview": self._preview(suffix, content), "path": str(destination)}

    def delete(self, session_id: str, filename: str) -> None:
        if "/" in filename or "\\" in filename or ".." in filename:
            raise HTTPException(status_code=400, detail="Invalid filename")
        path = session_sandbox(session_id) / filename
        if path.exists():
            path.unlink()

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
