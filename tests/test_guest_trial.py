"""What a guest gets: the guest model whatever it asks for, a conversation
remembered in memory only (nothing written to the database), and files kept
apart from the owner's — a guest can't read the owner's PDFs or formula
images, and the owner's lists don't fill up with guests' uploads.
"""
import pytest
from fastapi.testclient import TestClient

from backend.app.core import auth
from backend.app.core.config import settings
from backend.app.core.csrf import CLIENT_HEADER

PASSWORD = "mat-khau-thu-nghiem"


@pytest.fixture
def secured(monkeypatch):
    monkeypatch.setattr(settings, "OWNER_PASSWORD", PASSWORD)
    monkeypatch.setattr(settings, "SESSION_SECRET", None)
    monkeypatch.setattr(settings, "GUEST_ENABLED", True)
    monkeypatch.setattr(settings, "GUEST_DAILY_LIMIT", 50)
    monkeypatch.setattr(settings, "GUEST_PROVIDER", None)
    monkeypatch.setattr(settings, "GUEST_MODEL", None)


@pytest.fixture
def guest():
    from main import app

    return TestClient(app, headers={CLIENT_HEADER: "test"})


@pytest.fixture
def owner():
    from main import app

    client = TestClient(app, headers={CLIENT_HEADER: "test"})
    assert client.post("/api/auth/login", json={"password": PASSWORD}).status_code == 200
    return client


def _server_default():
    from backend.app.core.llm import _resolve_model

    return settings.DEFAULT_PROVIDER, _resolve_model(settings.DEFAULT_PROVIDER, settings.DEFAULT_MODEL)


# ── models and chat ─────────────────────────────────────────────────────


def test_a_guest_is_offered_only_the_guest_model(secured, guest, owner):
    provider, model = _server_default()

    offered = guest.get("/api/models").json()
    assert [(m["provider"], m["model"]) for m in offered["models"]] == [(provider, model)]
    assert offered["default"] == {"provider": provider, "model": model}
    assert len(owner.get("/api/models").json()["models"]) >= 1


def test_guest_chat_uses_the_guest_model_and_remembers_only_in_memory(secured, guest, monkeypatch):
    import backend.app.shared.conversation_store as conv_mod

    calls = []

    async def fake_llm(messages, system="", provider=None, model=None):
        calls.append({"messages": messages, "provider": provider, "model": model})
        yield f"trả lời {len(calls)}"

    monkeypatch.setattr(conv_mod, "astream_chat", fake_llm)
    ask = {"message": "câu một", "session_id": "g-1", "provider": "anthropic", "model": "claude-something"}

    assert guest.post("/api/chat/stream", json=ask).status_code == 200
    assert guest.post("/api/chat/stream", json={**ask, "message": "câu hai"}).status_code == 200

    provider, model = _server_default()
    assert (calls[0]["provider"], calls[0]["model"]) == (provider, model)
    second = [m["content"] for m in calls[1]["messages"]]
    assert second == ["câu một", "trả lời 1", "câu hai"]  # context kept within the trial...
    assert not any("g-1" in key for key in conv_mod._store._data)  # ...but never stored


# ── PDFs ────────────────────────────────────────────────────────────────


def _pdf_bytes(text: str = "Tài liệu thử") -> bytes:
    import fitz

    doc = fitz.open()
    doc.new_page().insert_text((72, 72), text)
    return doc.tobytes()


@pytest.fixture
def pdf_dirs(tmp_path, monkeypatch):
    import backend.app.features.pdf.router as pdf_router

    from backend.app.features.pdf.processor import PDFProcessor
    from backend.app.features.pdf.repository import PdfRepository
    from backend.app.features.pdf.service import PdfService

    owner_dir, guest_dir = tmp_path / "pdfs", tmp_path / "pdfs" / "guest"
    monkeypatch.setattr(pdf_router, "_repository", PdfRepository(owner_dir))
    monkeypatch.setattr(pdf_router, "_service", PdfService(processor=PDFProcessor(owner_dir)))
    monkeypatch.setattr(pdf_router, "_guest", pdf_router.PdfSpace(guest_dir))
    (owner_dir / "bao-cao-rieng.pdf").write_bytes(_pdf_bytes("bí mật"))
    return owner_dir, guest_dir


def _upload(client, name="bai-giang.pdf", content=None):
    return client.post("/api/pdf/upload", files={"file": (name, content or _pdf_bytes(), "application/pdf")})


def test_guest_uploads_live_apart_under_an_unguessable_name(secured, guest, owner, pdf_dirs):
    owner_dir, guest_dir = pdf_dirs

    uploaded = _upload(guest).json()

    assert uploaded["filename"] != "bai-giang.pdf" and uploaded["filename"].endswith("bai-giang.pdf")
    assert (guest_dir / uploaded["filename"]).exists()
    assert guest.get(f"/api/pdf/raw/{uploaded['filename']}").status_code == 200
    listed = [f["filename"] for f in owner.get("/api/pdf/list").json()["files"]]
    assert uploaded["filename"] not in listed


def test_a_guest_cannot_read_the_owners_pdfs(secured, guest, pdf_dirs):
    assert guest.get("/api/pdf/raw/bao-cao-rieng.pdf").status_code == 404
    assert guest.delete("/api/pdf/file/bao-cao-rieng.pdf").status_code == 404
    assert (pdf_dirs[0] / "bao-cao-rieng.pdf").exists()


def test_guest_uploads_are_capped_in_size(secured, guest, pdf_dirs, monkeypatch):
    monkeypatch.setattr(settings, "GUEST_MAX_UPLOAD_MB", 1)
    big = _pdf_bytes() + b"%" * (1024 * 1024 + 1)

    response = _upload(guest, content=big)

    assert response.status_code == 400
    assert "1MB" in response.json()["detail"]


def test_old_guest_uploads_are_pruned(secured, guest, pdf_dirs, monkeypatch):
    import backend.app.features.pdf.router as pdf_router

    monkeypatch.setattr(pdf_router, "GUEST_MAX_FILES", 3)
    for i in range(5):
        _upload(guest, name=f"f{i}.pdf")

    assert len(list(pdf_dirs[1].glob("*.pdf"))) == 3


# ── formula images ──────────────────────────────────────────────────────


def test_guest_formula_images_are_kept_apart(secured, guest, owner, monkeypatch, tmp_path):
    import backend.app.features.hmer.router as hmer_router

    seen = {}

    class FakeService:
        def __init__(self, name):
            self.name = name

        def validate_filename(self, filename):
            return filename

        async def recognize(self, filename, content):
            seen["recognize"] = self.name

            class R:
                latex, score, elapsed_ms, device = "x^2", 0.9, 1, "cpu"

            return filename, R()

    monkeypatch.setattr(hmer_router, "_service", FakeService("owner"))
    monkeypatch.setattr(hmer_router, "_guest_service", FakeService("guest"))
    image = {"file": ("f.png", b"\x89PNG fake", "image/png")}

    guest.post("/api/hmer/recognize", files=image)
    assert seen["recognize"] == "guest"
    owner.post("/api/hmer/recognize", files=image)
    assert seen["recognize"] == "owner"


def test_the_guest_hmer_service_shares_the_model_and_its_gpu_queue(tmp_path):
    from backend.app.features.hmer.service import HmerService

    class FakeRecognizer:
        pass

    owner_service = HmerService(recognizer=FakeRecognizer())
    guest_service = owner_service.for_directory(tmp_path / "guest")

    assert guest_service._recognizer is owner_service._recognizer
    assert guest_service._lock is owner_service._lock
    assert guest_service._repository is not owner_service._repository
