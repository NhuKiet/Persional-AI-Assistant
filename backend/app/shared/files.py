from pathlib import Path


def ensure_runtime_directories(base: Path) -> None:
    for name in ("papers", "sandbox", "pdfs"):
        (base / "data" / name).mkdir(parents=True, exist_ok=True)
