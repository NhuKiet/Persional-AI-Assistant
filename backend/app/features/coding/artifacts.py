from __future__ import annotations

import logging
import re
from pathlib import Path

from fastapi import HTTPException

from backend.app.features.coding.execution import SANDBOX_DIR


logger = logging.getLogger(__name__)

ARTIFACT_EXTS = {".png", ".jpg", ".jpeg", ".svg", ".html", ".gif"}
MIME_MAP = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".svg": "image/svg+xml", ".html": "text/html",
}


def safe_session_id(session_id: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_\-]", "_", session_id)[:64]


class ArtifactService:
    def list(self, session_id: str) -> list[str]:
        sandbox = SANDBOX_DIR / safe_session_id(session_id)
        try:
            return sorted(file.name for file in sandbox.iterdir() if file.suffix.lower() in ARTIFACT_EXTS)
        except FileNotFoundError:
            return []

    def resolve(self, session_id: str, filename: str) -> Path:
        if ".." in session_id or "/" in session_id or ".." in filename or "/" in filename:
            raise HTTPException(status_code=400, detail="Invalid path")
        path = (SANDBOX_DIR / safe_session_id(session_id) / filename).resolve()
        if not str(path).startswith(str(SANDBOX_DIR.resolve())):
            raise HTTPException(status_code=403, detail="Access denied")
        if not path.exists():
            raise HTTPException(status_code=404, detail=f"File not found: {filename}")
        return path

    def resolve_root(self, filename: str) -> Path:
        if "/" in filename or ".." in filename:
            raise HTTPException(status_code=400, detail="Invalid filename")
        path = SANDBOX_DIR / filename
        if not path.exists():
            raise HTTPException(status_code=404, detail=f"File not found: {filename}")
        return path

    @staticmethod
    def collect(snapshot_before: set[Path], sandbox: Path, session_id: str) -> list[str]:
        safe = safe_session_id(session_id)
        try:
            return sorted(f"{safe}/{file.name}" for file in sandbox.iterdir() if file.suffix.lower() in ARTIFACT_EXTS and file not in snapshot_before)
        except Exception as exc:
            logger.warning("Artifact scan error: %s", exc)
            return []
