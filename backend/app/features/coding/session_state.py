"""Variables a coding session keeps between requests, host side.

state_runner.py (in the container) saves them after each successful run
into `<sandbox>/.king/` and writes state.json describing them. The host
only ever reads that JSON — never the pickle — and treats it like any other
container output: a sandboxed run wrote it, so it may be a symlink planted
to read a host file, it may be huge, and its column names come from files
the user uploaded.
"""
import json
import logging
import os
from pathlib import Path

from backend.app.features.coding import state_runner
from backend.app.shared.untrusted import UNTRUSTED_GUARD, frame_untrusted

logger = logging.getLogger(__name__)

RUNNER_SOURCE = Path(state_runner.__file__).read_text(encoding="utf-8")

_MAX_MANIFEST_BYTES = 64 * 1024
_MAX_LISTED = 40
_MAX_NAME = 64
_MAX_SUMMARY = 200
_SKIP_REASONS = {
    "not_picklable": "can't be saved",
    "too_large": "too large to keep",
    "too_many": "over the variable limit",
}


def _state_file(sandbox: Path, name: str) -> Path | None:
    """`<sandbox>/.king/<name>` if it is a plain file inside the sandbox."""
    state_dir = sandbox / state_runner.STATE_DIR
    path = state_dir / name
    if state_dir.is_symlink() or path.is_symlink() or not path.is_file():
        return None
    resolved = path.resolve()
    if not resolved.is_relative_to(sandbox.resolve()):
        return None
    return resolved


def _clean(entries: object, field: str, limit: int) -> list[dict]:
    if not isinstance(entries, list):
        return []
    cleaned = []
    for entry in entries[:limit]:
        if isinstance(entry, dict) and isinstance(entry.get("name"), str) and isinstance(entry.get(field), str):
            cleaned.append({"name": entry["name"][:_MAX_NAME], field: entry[field][:_MAX_SUMMARY]})
    return cleaned


def read_kept_variables(sandbox: Path) -> dict:
    """{"variables": [{name, summary}], "skipped": [{name, reason}]} from the
    session's last successful run; empty lists when there is none."""
    empty = {"variables": [], "skipped": []}
    path = _state_file(sandbox, state_runner.MANIFEST_FILE)
    if path is None:
        return empty
    try:
        if path.stat().st_size > _MAX_MANIFEST_BYTES:
            return empty
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return empty
    if not isinstance(manifest, dict):
        return empty
    return {
        "variables": _clean(manifest.get("variables"), "summary", _MAX_LISTED),
        "skipped": _clean(manifest.get("skipped"), "reason", _MAX_LISTED),
    }


def kept_variables_context(sandbox: Path) -> str:
    """The prompt section telling plan/code/debug what is already defined."""
    kept = read_kept_variables(sandbox)
    parts = []
    if kept["variables"] or kept["skipped"]:
        lines = [f"  - {v['name']}: {v['summary']}" for v in kept["variables"]]
        lines += [f"  - {s['name']}: NOT available ({_SKIP_REASONS.get(s['reason'], 'not kept')}) — recreate it if needed" for s in kept["skipped"]]
        parts.append(
            "Variables already defined from earlier runs in this session — use them directly "
            "instead of recomputing them, unless the task needs them rebuilt. "
            + UNTRUSTED_GUARD + "\n" + frame_untrusted("\n".join(lines))
        )
    parts.append("Top-level variables this code leaves defined are kept for the user's next request in this session.")
    return "\n".join(parts) + "\n\n"


def clear_kept_variables(sandbox: Path) -> None:
    """Forget the session's variables. Never follows a planted link: a
    symlink is removed itself, and a directory that resolves outside the
    sandbox (a Windows junction isn't a symlink) is left alone."""
    state_dir = sandbox / state_runner.STATE_DIR
    try:
        if state_dir.is_symlink():
            state_dir.unlink()
            return
        if not state_dir.is_dir() or not state_dir.resolve().is_relative_to(sandbox.resolve()):
            return
        for name in (state_runner.STATE_FILE, state_runner.MANIFEST_FILE):
            for path in (state_dir / name, state_dir / f"{name}.tmp"):
                if path.is_symlink() or path.is_file():
                    os.unlink(path)
    except OSError:
        logger.warning("Could not clear kept variables in %s", sandbox, exc_info=True)
