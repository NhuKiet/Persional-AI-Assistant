from pathlib import Path

# Device names Windows resolves regardless of extension: "CON.txt" opens the
# console, "NUL.csv" swallows the write.
_WINDOWS_RESERVED = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}


def ensure_runtime_directories(base: Path) -> None:
    for name in ("papers", "sandbox", "pdfs"):
        (base / "data" / name).mkdir(parents=True, exist_ok=True)


def safe_filename(name: str | None) -> str:
    """Accept only a single plain file name — the one shape every upload
    endpoint (coding, pdf, hmer) stores. Raises ValueError; callers map it
    to HTTP 400.

    Checked on every OS because the backend also runs natively on Windows:
    - `/`, `\\`, `..`: classic traversal.
    - `:`: `base / "D:x.csv"` jumps to drive D, and `"a.txt:x.csv"` writes an
      NTFS alternate data stream.
    - control characters, and device names such as `CON.txt`.
    """
    if not name or "/" in name or "\\" in name or ":" in name or ".." in name:
        raise ValueError("Invalid filename")
    if name == "." or any(ord(ch) < 32 for ch in name):
        raise ValueError("Invalid filename")
    if name.split(".", 1)[0].upper() in _WINDOWS_RESERVED:
        raise ValueError("Invalid filename")
    return name


def contained_path(directory: Path, name: str | None) -> Path:
    """`directory / name` for a `safe_filename` name, rejected if it resolves
    outside `directory` — i.e. `name` already exists there as a symlink
    pointing elsewhere. The coding sandbox is writable from inside the
    container, so the backend must not read, write or delete through a link
    that generated code planted."""
    root = directory.resolve()
    path = root / safe_filename(name)
    if path.resolve().parent != root:
        raise ValueError("Invalid filename")
    return path
