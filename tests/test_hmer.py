"""HMER slice tests.

None of these load the real model: the checkpoint is not in the repository and
CI has no GPU. What they do cover is everything around it — the paths that must
behave correctly precisely *because* the model is often absent.

The router tests mount only the hmer router on a bare FastAPI app rather than
importing backend.app.main. Importing the real app pulls in langchain,
weaviate and FlagEmbedding through the other feature routers, which makes a
slice's own tests fail for reasons that have nothing to do with the slice.

Async service methods are driven with asyncio.run() because pytest-asyncio is
not among the project's dev dependencies.
"""
import asyncio
import io

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from backend.app.core import capabilities
from backend.app.features.hmer.recognizer import (
    HmerRecognizer,
    Recognition,
    RecognizerUnavailable,
)
from backend.app.features.hmer.repository import HmerRepository
from backend.app.features.hmer.service import HmerService


def _png_bytes(size=(64, 32)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, "white").save(buffer, format="PNG")
    return buffer.getvalue()


class _StubRecognizer:
    """Stands in for the real model so the slice can be tested without one."""

    def __init__(self, result=None, error=None):
        self._result = result
        self._error = error
        self.calls = 0

    def status(self):
        return {
            "configured": True,
            "checkpoint": "stub.ckpt",
            "checkpoint_exists": True,
            "loaded": True,
            "device": "cpu",
            "last_error": None,
        }

    def recognize(self, image_bytes):
        self.calls += 1
        if self._error:
            raise self._error
        return self._result


# ── Repository ──────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "filename",
    ["../escape.png", "sub/dir.png", "back\\slash.png", "", None],
)
def test_validate_filename_rejects_traversal(tmp_path, filename):
    repo = HmerRepository(tmp_path)
    with pytest.raises(ValueError):
        repo.validate_filename(filename)


def test_validate_filename_rejects_non_image(tmp_path):
    repo = HmerRepository(tmp_path)
    with pytest.raises(ValueError):
        repo.validate_filename("notes.pdf")


def test_save_prefixes_so_same_name_does_not_overwrite(tmp_path):
    repo = HmerRepository(tmp_path)
    first = repo.save("bai1.png", b"one")
    second = repo.save("bai1.png", b"two")

    assert first != second
    assert first.read_bytes() == b"one"
    assert second.read_bytes() == b"two"
    assert len(repo.list()) == 2


# ── Recognizer availability ─────────────────────────────────────────────

@pytest.fixture
def unconfigured(monkeypatch):
    """`checkpoint=None` means "read settings", not "unconfigured" — so a test
    that wants the unconfigured state must also clear the setting, or it reads
    whatever the developer's own .env holds and fails only on machines where
    HMER is set up."""
    from backend.app.core.config import settings

    monkeypatch.setattr(settings, "HMER_CHECKPOINT", None)


def test_status_reports_unconfigured_checkpoint(unconfigured):
    status = HmerRecognizer(checkpoint=None).status()

    assert status["configured"] is False
    assert status["checkpoint_exists"] is False
    assert status["loaded"] is False


def test_status_reports_missing_checkpoint_file(tmp_path):
    status = HmerRecognizer(checkpoint=str(tmp_path / "absent.ckpt")).status()

    assert status["configured"] is True
    assert status["checkpoint_exists"] is False


def test_ensure_loaded_without_checkpoint_disables_capability(unconfigured):
    recognizer = HmerRecognizer(checkpoint=None)

    with pytest.raises(RecognizerUnavailable, match="HMER_CHECKPOINT"):
        recognizer.ensure_loaded()

    snapshot = capabilities.snapshot()
    assert snapshot["capabilities"]["hmer"]["status"] == capabilities.DISABLED
    # A deliberately unconfigured optional model must not drag the whole
    # process into "degraded" — that is what teaches operators to ignore it.
    assert snapshot["status"] == capabilities.OK


def test_ensure_loaded_with_missing_file_names_the_path(tmp_path):
    recognizer = HmerRecognizer(checkpoint=str(tmp_path / "nope.ckpt"))

    with pytest.raises(RecognizerUnavailable, match="nope.ckpt"):
        recognizer.ensure_loaded()


# ── Preprocessing ───────────────────────────────────────────────────────

def test_to_tensor_matches_training_shape_and_range():
    """Training fed [0, 255] grayscale replicated to three channels.

    Guards against someone "fixing" this into the usual to_tensor + ImageNet
    normalize recipe, which is what the original demo did and what the model
    was never trained on.
    """
    torch = pytest.importorskip("torch")
    recognizer = HmerRecognizer(checkpoint=None)

    tensor = recognizer._to_tensor(_png_bytes())

    assert tensor.shape == (1, 3, 256, 256)
    assert tensor.dtype == torch.float32
    assert tensor.max() > 1.0, "values must stay in [0, 255], not be scaled to [0, 1]"
    assert tensor.max() <= 255.0
    # Three identical channels, as collate_fn produced during training.
    assert torch.equal(tensor[0, 0], tensor[0, 1])
    assert torch.equal(tensor[0, 1], tensor[0, 2])


# ── Service ─────────────────────────────────────────────────────────────

def test_recognize_saves_image_then_returns_result(tmp_path):
    stub = _StubRecognizer(Recognition("x ^ 2", -0.4, 12, "cpu"))
    service = HmerService(recognizer=stub, repository=HmerRepository(tmp_path))

    stored_name, recognition = asyncio.run(
        service.recognize("bai1.png", _png_bytes())
    )

    assert recognition.latex == "x ^ 2"
    assert stub.calls == 1
    assert (tmp_path / stored_name).is_file()


def test_recognize_keeps_the_image_when_inference_fails(tmp_path):
    """The input that caused a failure must survive it, or the failure is
    not reproducible afterwards."""
    stub = _StubRecognizer(error=RuntimeError("CUDA out of memory"))
    service = HmerService(recognizer=stub, repository=HmerRepository(tmp_path))

    with pytest.raises(RuntimeError):
        asyncio.run(service.recognize("bai1.png", _png_bytes()))

    assert len(list(tmp_path.iterdir())) == 1


# ── Router ──────────────────────────────────────────────────────────────

@pytest.fixture
def client(tmp_path, monkeypatch):
    from backend.app.features.hmer import router as router_module

    monkeypatch.setattr(
        router_module,
        "_service",
        HmerService(
            recognizer=_StubRecognizer(Recognition("1 + 1", -0.1, 5, "cpu")),
            repository=HmerRepository(tmp_path),
        ),
    )

    app = FastAPI()
    app.include_router(router_module.router)
    return TestClient(app)


def test_status_endpoint_is_200_even_when_unavailable(client):
    assert client.get("/api/hmer/status").status_code == 200


def test_recognize_rejects_non_image(client):
    response = client.post(
        "/api/hmer/recognize",
        files={"file": ("notes.pdf", b"%PDF-1.4", "application/pdf")},
    )
    assert response.status_code == 400


def test_recognize_rejects_empty_file(client):
    response = client.post(
        "/api/hmer/recognize",
        files={"file": ("bai1.png", b"", "image/png")},
    )
    assert response.status_code == 400


def test_recognize_returns_latex(client):
    response = client.post(
        "/api/hmer/recognize",
        files={"file": ("bai1.png", _png_bytes(), "image/png")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["latex"] == "1 + 1"
    assert body["device"] == "cpu"


def test_recognize_reports_503_when_model_unavailable(client, monkeypatch):
    from backend.app.features.hmer import router as router_module

    monkeypatch.setattr(
        router_module._service,
        "_recognizer",
        _StubRecognizer(error=RecognizerUnavailable("Không tìm thấy checkpoint")),
    )

    response = client.post(
        "/api/hmer/recognize",
        files={"file": ("bai1.png", _png_bytes(), "image/png")},
    )

    assert response.status_code == 503
    assert "checkpoint" in response.json()["detail"]
