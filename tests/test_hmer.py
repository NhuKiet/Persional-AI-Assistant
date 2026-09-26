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
    Explanation,
    HmerRecognizer,
    Recognition,
    RecognizerUnavailable,
    UnknownTokens,
)
from backend.app.features.hmer.repository import HmerRepository
from backend.app.features.hmer.service import HmerService


def _png_bytes(size=(64, 32)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, "white").save(buffer, format="PNG")
    return buffer.getvalue()


class _StubRecognizer:
    """Stands in for the real model so the slice can be tested without one."""

    def __init__(self, result=None, error=None, explanation=None, explain_error=None):
        self._result = result
        self._error = error
        self._explanation = explanation
        self._explain_error = explain_error
        self.calls = 0
        self.explain_calls = []

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

    def explain(self, image_bytes, tokens):
        self.explain_calls.append((image_bytes, tokens))
        if self._explain_error:
            raise self._explain_error
        return self._explanation


# ── Repository ──────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "filename",
    ["../escape.png", "sub/dir.png", "back\\slash.png", "", None,
     "D:escape.png", "a.png:x.png", "CON.png"],
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


# ── Explain: occlusion evidence ─────────────────────────────────────────

class _InkReadingModel:
    """A fake SwinCoMER whose token i is sure of itself exactly when there is
    ink in one known cell, so the evidence explain() reports can be checked
    against where the ink really is.

    Stands in for model.comer_model (encoder, decoder) and parameters().
    """

    def __init__(self, cells):
        import torch

        self._torch = torch
        self._cells = cells              # token index -> (row, col) it reads
        self.forward_batches = []
        self.comer_model = self
        self.encoder = self._encode
        self.decoder = self._decode

    def parameters(self):
        return iter([self._torch.zeros(1)])

    def _encode(self, imgs, mask):
        return imgs, mask

    def _decode(self, feature, mask, tgt):
        from backend.app.features.hmer.occlusion import COLS, ROWS, cell_bounds

        torch = self._torch
        batch, steps = tgt.shape
        self.forward_batches.append(batch)
        logits = torch.zeros(batch, steps, 16)
        ys, xs = cell_bounds(256, ROWS), cell_bounds(256, COLS)
        for i, (r, c) in enumerate(self._cells):
            region = feature[:, 0, ys[r][0]:ys[r][1], xs[c][0]:xs[c][1]]
            ink = (region < 128).float().mean(dim=(1, 2))      # [batch]
            logits[:, i, tgt[0, i + 1]] = 6.0 * ink
        return logits


class _FakeVocab:
    SOS_IDX = 1

    def __init__(self, words):
        self.word2idx = {w: i + 3 for i, w in enumerate(words)}


def _ink_png(cells):
    """256 x 256 white image with a dark block filling each (row, col) cell."""
    from backend.app.features.hmer.occlusion import COLS, ROWS, cell_bounds

    image = Image.new("L", (256, 256), 250)
    ys, xs = cell_bounds(256, ROWS), cell_bounds(256, COLS)
    for r, c in cells:
        image.paste(30, (xs[c][0], ys[r][0], xs[c][1], ys[r][1]))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _fake_recognizer(cells, words):
    recognizer = HmerRecognizer(checkpoint="unused.ckpt")
    recognizer._model = _InkReadingModel(cells)
    recognizer._vocab = _FakeVocab(words)
    recognizer._device = "cpu"
    return recognizer


def test_explain_puts_each_tokens_evidence_on_the_ink_it_reads():
    pytest.importorskip("torch")
    from backend.app.features.hmer.occlusion import COLS, EXPLAIN_BATCH, ROWS

    cells = [(1, 2), (1, 7), (0, 12), (3, 15)]
    recognizer = _fake_recognizer(cells, ["x", "+", "1", "y"])

    result = recognizer.explain(_ink_png(cells), ["x", "+", "1", "y"])

    assert (result.rows, result.cols) == (ROWS, COLS)
    assert len(result.tokens) == len(result.token_probs) == len(result.weights) == len(result.no_evidence) == 4
    for i, (r, c) in enumerate(cells):
        assert len(result.weights[i]) == ROWS * COLS
        assert result.weights[i].index(max(result.weights[i])) == r * COLS + c, f"token {i}"
        assert sum(result.weights[i]) == pytest.approx(1.0, abs=1e-3)
    assert not any(result.no_evidence)
    # 1 baseline pass, then the 64 occluded copies in chunks of EXPLAIN_BATCH.
    batches = recognizer._model.forward_batches
    assert batches[0] == 1
    assert batches[1:] == [EXPLAIN_BATCH] * (ROWS * COLS // EXPLAIN_BATCH)


def test_explain_flags_every_token_on_a_blank_image():
    """Nothing to hide means nothing to point at, not a noise map."""
    pytest.importorskip("torch")
    recognizer = _fake_recognizer([(1, 2), (2, 9)], ["a", "b"])

    result = recognizer.explain(_png_bytes((256, 256)), ["a", "b"])

    assert result.no_evidence == [True, True]
    assert all(w == 0 for row in result.weights for w in row)


def test_explain_rejects_tokens_outside_the_vocabulary():
    pytest.importorskip("torch")
    recognizer = _fake_recognizer([(0, 0)], ["x"])

    with pytest.raises(UnknownTokens, match="zp"):
        recognizer.explain(_png_bytes((256, 256)), ["x", "zp"])


def _explanation(tokens=("1", "+", "1")):
    n = len(tokens)
    return Explanation(
        tokens=list(tokens),
        token_probs=[0.9] * n,
        rows=4,
        cols=16,
        weights=[[1.0] + [0.0] * 63 for _ in range(n)],
        no_evidence=[False] * n,
        elapsed_ms=2100,
    )


def test_service_explain_reads_the_stored_image_and_splits_the_latex(tmp_path):
    stub = _StubRecognizer(explanation=_explanation())
    repository = HmerRepository(tmp_path)
    stored = repository.save("bai1.png", b"stored-bytes")
    service = HmerService(recognizer=stub, repository=repository)

    asyncio.run(service.explain(stored.name, "1 + 1"))

    assert stub.explain_calls == [(b"stored-bytes", ["1", "+", "1"])]


def test_service_explain_waits_for_the_same_lock_as_recognition(tmp_path):
    """One model on one 4 GB GPU: an explain racing a recognition would
    fight it for VRAM, and on Windows that means paging, not an error."""
    stub = _StubRecognizer(explanation=_explanation())
    repository = HmerRepository(tmp_path)
    stored = repository.save("bai1.png", b"img")
    service = HmerService(recognizer=stub, repository=repository)

    async def scenario():
        await service._lock.acquire()
        task = asyncio.create_task(service.explain(stored.name, "1 + 1"))
        await asyncio.sleep(0.05)
        assert stub.explain_calls == []
        service._lock.release()
        await task

    asyncio.run(scenario())
    assert len(stub.explain_calls) == 1


@pytest.fixture
def explain_client(tmp_path, monkeypatch):
    from backend.app.features.hmer import router as router_module

    stub = _StubRecognizer(explanation=_explanation())
    repository = HmerRepository(tmp_path)
    stored = repository.save("bai1.png", _png_bytes())
    monkeypatch.setattr(router_module, "_service", HmerService(recognizer=stub, repository=repository))

    app = FastAPI()
    app.include_router(router_module.router)
    return TestClient(app), stored.name, stub


def test_explain_endpoint_returns_the_evidence_map(explain_client):
    client, stored, _ = explain_client

    response = client.post("/api/hmer/explain", json={"filename": stored, "latex": "1 + 1"})

    assert response.status_code == 200
    body = response.json()
    assert body["tokens"] == ["1", "+", "1"]
    assert len(body["token_probs"]) == 3
    assert body["evidence"]["rows"] == 4 and body["evidence"]["cols"] == 16
    assert len(body["evidence"]["weights"]) == len(body["evidence"]["no_evidence"]) == 3
    assert all(len(row) == 64 for row in body["evidence"]["weights"])
    assert body["elapsed_ms"] == 2100


@pytest.mark.parametrize(
    ("payload", "status"),
    [
        ({"filename": "../escape.png", "latex": "1"}, 400),
        ({"filename": "missing.png", "latex": "1"}, 404),
    ],
)
def test_explain_endpoint_rejects_bad_files(explain_client, payload, status):
    client, _, _ = explain_client
    assert client.post("/api/hmer/explain", json=payload).status_code == status


def test_explain_endpoint_rejects_empty_latex(explain_client):
    client, stored, stub = explain_client

    response = client.post("/api/hmer/explain", json={"filename": stored, "latex": "   "})

    assert response.status_code == 400
    assert stub.explain_calls == []


def test_explain_endpoint_reports_unknown_tokens_as_400(explain_client):
    client, stored, stub = explain_client
    stub._explain_error = UnknownTokens("Token không có trong từ vựng của mô hình: zp")

    response = client.post("/api/hmer/explain", json={"filename": stored, "latex": "zp"})

    assert response.status_code == 400
    assert "zp" in response.json()["detail"]


def test_explain_endpoint_reports_503_when_model_unavailable(explain_client):
    client, stored, stub = explain_client
    stub._explain_error = RecognizerUnavailable("Không tìm thấy checkpoint")

    response = client.post("/api/hmer/explain", json={"filename": stored, "latex": "1"})

    assert response.status_code == 503
    assert "checkpoint" in response.json()["detail"]


# ── Real model (opt-in) ─────────────────────────────────────────────────

_SAMPLE = r"C:/Users/longt/Music/CapstoneProject_SP25AI12/SwinCoMER/example/UN19_1041_em_595.bmp"
_SAMPLE_GT = r"x ^ { 2 } = \sum \limits _ { a = 1 } ^ { 3 } x _ { a } ^ { 2 }"


def _real_model_available() -> bool:
    import importlib.util
    from pathlib import Path

    from backend.app.core.config import settings

    return bool(settings.HMER_CHECKPOINT) and importlib.util.find_spec("comer") is not None and Path(_SAMPLE).is_file()


@pytest.mark.skipif(not _real_model_available(), reason="needs HMER_CHECKPOINT, the comer package and the capstone sample")
def test_real_model_explains_the_sample():
    from pathlib import Path

    recognizer = HmerRecognizer()
    tokens = _SAMPLE_GT.split()

    result = recognizer.explain(Path(_SAMPLE).read_bytes(), tokens)

    assert result.tokens == tokens
    assert len(result.weights) == len(result.token_probs) == len(tokens)
    assert all(len(row) == result.rows * result.cols for row in result.weights)
    assert min(result.token_probs) > 0.1, "ground truth on its own image should not look implausible"


@pytest.mark.parametrize("method", ["get", "delete"])
def test_image_routes_reject_drive_relative_name(client, method):
    response = getattr(client, method)("/api/hmer/images/D:x.png")
    assert response.status_code == 400
