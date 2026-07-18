import pytest

from backend.app.features.pdf.repository import PdfRepository


def test_repository_rejects_path_traversal(tmp_path):
    repository = PdfRepository(tmp_path)

    with pytest.raises(ValueError):
        repository.resolve("../secrets.pdf")
