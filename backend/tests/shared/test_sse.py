from pathlib import Path

from backend.app.shared.files import ensure_runtime_directories
from backend.app.shared.sse import sse


def test_sse_keeps_unicode_json_and_event_framing():
    assert sse({"type": "token", "content": "Tiếng Việt"}) == (
        'data: {"type": "token", "content": "Tiếng Việt"}\n\n'
    )


def test_runtime_directories_are_created_under_given_base(tmp_path: Path):
    ensure_runtime_directories(tmp_path)

    assert (tmp_path / "data" / "papers").is_dir()
    assert (tmp_path / "data" / "sandbox").is_dir()
    assert (tmp_path / "data" / "pdfs").is_dir()
