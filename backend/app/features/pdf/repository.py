from pathlib import Path


class PdfRepository:
    def __init__(self, directory: Path):
        self._directory = directory
        self._directory.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def validate_filename(filename: str | None) -> str:
        if not filename or "/" in filename or "\\" in filename or ".." in filename:
            raise ValueError("Invalid filename")
        return filename

    def resolve(self, filename: str | None) -> Path:
        return self._directory / self.validate_filename(filename)

    def save(self, filename: str, content: bytes) -> Path:
        path = self.resolve(filename)
        path.write_bytes(content)
        return path

    def list(self, document_cache: dict[str, object]) -> list[dict]:
        files = []
        for path in self._directory.iterdir():
            if path.suffix.lower() != ".pdf":
                continue
            info = {"filename": path.name, "size": path.stat().st_size}
            if path.name in document_cache:
                document = document_cache[path.name]
                info["total_pages"] = document.total_pages
                info["total_chars"] = document.total_chars
            files.append(info)
        return sorted(files, key=lambda item: item["filename"])

    def delete(self, filename: str) -> None:
        self.resolve(filename).unlink(missing_ok=True)
