import uuid
from pathlib import Path

ALLOWED_SUFFIXES = {".png", ".jpg", ".jpeg", ".bmp"}


class HmerRepository:
    """Keeps the uploaded expression images on disk.

    Recognition itself works from bytes and never needs the file, but keeping
    the image lets the UI show what was recognized next to the LaTeX, and
    makes a bad result reproducible after the fact.
    """

    def __init__(self, directory: Path):
        self._directory = directory
        self._directory.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def validate_filename(filename: str | None) -> str:
        if not filename or "/" in filename or "\\" in filename or ".." in filename:
            raise ValueError("Tên file không hợp lệ")
        if Path(filename).suffix.lower() not in ALLOWED_SUFFIXES:
            raise ValueError(
                "Chỉ chấp nhận ảnh " + ", ".join(sorted(ALLOWED_SUFFIXES))
            )
        return filename

    def resolve(self, filename: str | None) -> Path:
        return self._directory / self.validate_filename(filename)

    def save(self, filename: str, content: bytes) -> Path:
        # Prefixed with a UUID because two uploads of "bai1.png" from different
        # sessions must not overwrite each other.
        stored = f"{uuid.uuid4().hex}_{self.validate_filename(filename)}"
        path = self._directory / stored
        path.write_bytes(content)
        return path

    def list(self) -> list[dict]:
        files = [
            {"filename": path.name, "size": path.stat().st_size}
            for path in self._directory.iterdir()
            if path.suffix.lower() in ALLOWED_SUFFIXES
        ]
        return sorted(files, key=lambda item: item["filename"])

    def delete(self, filename: str) -> None:
        self.resolve(filename).unlink(missing_ok=True)
