from __future__ import annotations

import logging
import re
from pathlib import Path, PurePosixPath

from fastapi import HTTPException
from fastapi.responses import FileResponse, Response

from backend.app.features.coding.execution import SANDBOX_DIR, safe_session_id


logger = logging.getLogger(__name__)

ARTIFACT_EXTS = {".png", ".jpg", ".jpeg", ".svg", ".html", ".gif"}
MIME_MAP = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".svg": "image/svg+xml", ".html": "text/html",
}

# Artifact suffixes that must never be rendered inline by the browser: an
# HTML/SVG artifact served inline could execute script in the app's origin.
# These are always forced to download as an attachment.
ATTACHMENT_ONLY_EXTS = {".html", ".svg"}

_DRIVE_PREFIX_RE = re.compile(r"^[a-zA-Z]:")


def _reject(status_code: int, reason_code: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail=reason_code)


def validate_relative_path(filename: str, root: Path, allowed_suffixes: set[str]) -> Path:
    """Canonicalize `filename` under `root` and reject any attempt to escape it.

    Rejects empty input, backslashes (Windows separators are never accepted,
    even on Windows), absolute paths, drive-letter prefixes, and `.`/`..`
    path components. The candidate and root are canonicalized with
    `Path.resolve(strict=False)` and containment is checked with
    `candidate.relative_to(root)` — never string-prefix comparison — so a
    symlinked directory that resolves outside `root` is also rejected.

    If `allowed_suffixes` is empty, the suffix check is skipped (used for
    directory-like path segments such as a sanitized session id).
    """
    if not filename:
        raise _reject(400, "empty_filename")
    if "\\" in filename:
        raise _reject(400, "backslash_in_path")
    if _DRIVE_PREFIX_RE.match(filename):
        raise _reject(400, "drive_prefix")

    pure = PurePosixPath(filename)
    if pure.is_absolute():
        raise _reject(400, "absolute_path")
    if not pure.parts or any(part in (".", "..") for part in pure.parts):
        raise _reject(400, "path_traversal")

    canonical_root = root.resolve(strict=False)
    candidate = (canonical_root / filename).resolve(strict=False)
    try:
        candidate.relative_to(canonical_root)
    except ValueError:
        raise _reject(403, "outside_sandbox_root") from None

    if allowed_suffixes and candidate.suffix.lower() not in allowed_suffixes:
        raise _reject(400, "disallowed_suffix")

    return candidate


def emit_path_rejected(session_id: str, reason_code: str) -> None:
    """Audit log for a rejected path.

    Only a sanitized session id and a categorical reason code are logged —
    never the raw filename/path, which could reveal host paths.
    """
    logger.warning(
        "coding.path_rejected feature=coding session_id=%s reason_code=%s",
        safe_session_id(session_id),
        reason_code,
    )


def artifact_response(path: Path) -> Response:
    """Build the HTTP response for serving an artifact file.

    `.html`/`.svg` are always forced to download as an attachment with
    `X-Content-Type-Options: nosniff` — they must never be inline-previewed,
    since an inline render would execute in the app's own origin. Image
    types keep the existing inline behavior for the UI.
    """
    suffix = path.suffix.lower()
    media_type = MIME_MAP.get(suffix, "application/octet-stream")
    if suffix in ATTACHMENT_ONLY_EXTS:
        return Response(
            content=path.read_bytes(),
            media_type=media_type,
            headers={
                "Content-Disposition": f'attachment; filename="{path.name}"',
                "X-Content-Type-Options": "nosniff",
            },
        )
    return FileResponse(str(path), media_type=media_type)


class ArtifactService:
    def list(self, session_id: str) -> list[str]:
        sandbox = SANDBOX_DIR / safe_session_id(session_id)
        try:
            return sorted(file.name for file in sandbox.iterdir() if file.suffix.lower() in ARTIFACT_EXTS)
        except FileNotFoundError:
            return []

    def resolve(self, session_id: str, filename: str) -> Path:
        try:
            session_root = validate_relative_path(safe_session_id(session_id), SANDBOX_DIR, set())
            path = validate_relative_path(filename, session_root, ARTIFACT_EXTS)
        except HTTPException as exc:
            emit_path_rejected(session_id, str(exc.detail))
            raise
        if not path.exists():
            raise HTTPException(status_code=404, detail=f"File not found: {filename}")
        return path

    def resolve_root(self, filename: str) -> Path:
        # SANDBOX_DIR is the shared parent of every session's subdirectory
        # (see session_sandbox() in uploads.py) — it is not itself a leaf
        # directory. validate_relative_path only rejects `.`/`..`, absolute
        # paths, drive prefixes, and backslashes; a forward-slash-nested
        # name like "other-session/secret.png" would otherwise still
        # resolve (validly) into a *different* session's directory. Since
        # this method is root-scoped, filenames here must be a single path
        # segment — no subdirectory nesting allowed.
        try:
            if "/" in filename:
                raise _reject(400, "nested_path_not_allowed")
            path = validate_relative_path(filename, SANDBOX_DIR, ARTIFACT_EXTS)
        except HTTPException as exc:
            emit_path_rejected("(root)", str(exc.detail))
            raise
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
