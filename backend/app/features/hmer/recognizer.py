"""SwinCoMER inference: handwritten maths image in, LaTeX out.

The model lives in a separate repository (CapstoneProject_SP25AI12) and is
installed as the `comer` package via `pip install -e <repo>/SwinCoMER`. Its
weights are a checkpoint file that is deliberately not in either repository.

Both of those can be absent on a given machine, and neither is worth crashing
the app over — KiNg must start and serve chat/research/PDF whether or not the
maths recognizer is usable here. So every failure path resolves to a status
this module can report, never to an exception escaping import or startup.
"""
from __future__ import annotations

import io
import logging
import time
from dataclasses import dataclass
from pathlib import Path

from backend.app.core import capabilities
from backend.app.core.config import settings

logger = logging.getLogger(__name__)

__all__ = ["HmerRecognizer", "Recognition", "RecognizerUnavailable"]

# The training pipeline (SwinCoMER/comer/datamodule/transforms.py) is:
#   PIL.convert("L") -> np.array -> A.Resize(256, 256) -> ToTensorV2()
# Albumentations' ToTensorV2 does not divide by 255, and no A.Normalize appears
# anywhere in that pipeline, so the model was trained on float values in
# [0, 255] with three identical (grayscale) channels. Feeding it ImageNet-
# normalized RGB instead is train/serve skew, so this module reproduces the
# training transform rather than reaching for the usual torchvision recipe.
INPUT_SIZE = 256


@dataclass(frozen=True)
class Recognition:
    latex: str
    score: float
    elapsed_ms: int
    device: str


class RecognizerUnavailable(RuntimeError):
    """Raised when a recognition is requested but the model cannot serve it.

    Carries the operator-facing reason so the router can turn it into a 503
    body that says what to fix, rather than a bare "service unavailable".
    """


class HmerRecognizer:
    """Loads the checkpoint on first use and serves single-expression images.

    Not thread-safe on purpose: a single model instance on one GPU cannot
    serve concurrent requests without fighting over memory. The caller
    (HmerService) serializes access; this class stays simple.
    """

    def __init__(self, checkpoint: str | None = None, device: str | None = None):
        self._checkpoint = checkpoint if checkpoint is not None else settings.HMER_CHECKPOINT
        self._device_pref = device or settings.HMER_DEVICE
        self._model = None
        self._vocab = None
        self._device = None
        self._load_error: str | None = None

    # ── Availability ────────────────────────────────────────────────────

    def configured(self) -> bool:
        """Whether an operator has pointed this at a checkpoint at all."""
        return bool(self._checkpoint)

    def checkpoint_exists(self) -> bool:
        return self.configured() and Path(self._checkpoint).is_file()

    def status(self) -> dict:
        """Everything needed to explain why recognition is or isn't working.

        Reported before any model load is attempted, so an operator can see
        a missing checkpoint without first sending an image that will fail.
        """
        return {
            "configured": self.configured(),
            "checkpoint": self._checkpoint,
            "checkpoint_exists": self.checkpoint_exists(),
            "loaded": self._model is not None,
            "device": self._device,
            "last_error": self._load_error,
        }

    # ── Loading ─────────────────────────────────────────────────────────

    def _resolve_device(self, torch) -> object:
        if self._device_pref == "cpu":
            return torch.device("cpu")
        if self._device_pref == "cuda":
            return torch.device("cuda")
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")

    def _load(self) -> None:
        """Import the model package, then restore the checkpoint onto it.

        Import is deferred to here rather than module top level: `comer` drags
        in torch, timm and pytorch-lightning, and an optional feature must not
        add seconds to KiNg's startup — nor fail it when the package is simply
        not installed on this machine.
        """
        if not self.configured():
            raise RecognizerUnavailable(
                "HMER_CHECKPOINT chưa được cấu hình trong .env"
            )
        if not self.checkpoint_exists():
            raise RecognizerUnavailable(
                f"Không tìm thấy checkpoint tại '{self._checkpoint}'"
            )

        try:
            import torch
            from comer.datamodule import vocab
            from comer.lit_comer_swin import LitCoMER
        except ImportError as exc:
            raise RecognizerUnavailable(
                "Chưa cài package 'comer'. Chạy: "
                "pip install -e <CapstoneProject_SP25AI12>/SwinCoMER"
            ) from exc

        device = self._resolve_device(torch)
        logger.info("Loading SwinCoMER checkpoint on %s", device)

        # NOTE: LitCoMER builds SwinV2PretrainedEncoder with pretrained=True,
        # so this downloads ImageNet weights from the timm hub and then
        # immediately overwrites them with the checkpoint's. Harmless but slow,
        # and it makes startup need network access. The fix belongs upstream in
        # the capstone repo (pass pretrained=False when restoring).
        model = LitCoMER.load_from_checkpoint(self._checkpoint, map_location=device)
        model.eval()
        model.to(device)

        self._model = model
        self._vocab = vocab
        self._device = str(device)
        self._load_error = None

    def ensure_loaded(self) -> None:
        if self._model is not None:
            return
        try:
            self._load()
        except RecognizerUnavailable as exc:
            self._load_error = str(exc)
            capabilities.disabled(capabilities.HMER)
            raise
        except Exception as exc:  # noqa: BLE001 - reported, not swallowed
            self._load_error = f"{type(exc).__name__}: {exc}"
            logger.exception("SwinCoMER checkpoint failed to load")
            capabilities.failed(capabilities.HMER, self._load_error)
            raise RecognizerUnavailable(
                f"Nạp checkpoint thất bại: {self._load_error}"
            ) from exc

    # ── Inference ───────────────────────────────────────────────────────

    def _to_tensor(self, image_bytes: bytes):
        """Reproduce the training transform: grayscale, 256x256, [0, 255].

        Pillow's BILINEAR is used where training used cv2's INTER_LINEAR (the
        default of A.Resize). The two differ slightly on downscale because
        Pillow antialiases and cv2 does not; matching exactly would mean
        adding opencv to KiNg's dependencies for one resize call. Flagged here
        so the choice is visible if recognition quality ever looks off.
        """
        import numpy as np
        import torch
        from PIL import Image

        with Image.open(io.BytesIO(image_bytes)) as img:
            gray = img.convert("L").resize(
                (INPUT_SIZE, INPUT_SIZE), Image.Resampling.BILINEAR
            )
            arr = np.array(gray, dtype=np.uint8)

        tensor = torch.from_numpy(arr).float()          # [H, W] in [0, 255]
        tensor = tensor.unsqueeze(0).repeat(3, 1, 1)    # [3, H, W]
        return tensor.unsqueeze(0)                      # [1, 3, H, W]

    def recognize(self, image_bytes: bytes) -> Recognition:
        self.ensure_loaded()

        import torch

        started = time.perf_counter()
        img = self._to_tensor(image_bytes)

        # The model's own device wins over the configured preference: a CUDA
        # OOM during load can leave the model on CPU, and sending it a CUDA
        # tensor would then fail with a device mismatch rather than a clear
        # out-of-memory error.
        device = next(self._model.parameters()).device
        img = img.to(device)

        batch, _, height, width = img.shape
        # The encoder ignores this mask (it rebuilds an all-zeros one), but the
        # decoder's signature requires it and every image here is exactly
        # 256x256, so there is no padding to mask anyway.
        mask = torch.zeros((batch, height, width), dtype=torch.bool, device=device)

        try:
            with torch.no_grad():
                hyps = self._model.approximate_joint_search(img, mask)
        except Exception as exc:  # noqa: BLE001 - reported, not swallowed
            capabilities.failed(capabilities.HMER, f"{type(exc).__name__}: {exc}")
            raise
        finally:
            if device.type == "cuda":
                torch.cuda.empty_cache()

        elapsed_ms = int((time.perf_counter() - started) * 1000)

        if not hyps:
            # An empty beam is a real outcome, not an error: the model ran and
            # had nothing above threshold to say.
            capabilities.ok(capabilities.HMER)
            return Recognition("", 0.0, elapsed_ms, str(device))

        best = hyps[0]
        latex = self._vocab.indices2label(best.seq)
        score = float(best.score)

        capabilities.ok(capabilities.HMER)
        return Recognition(latex, score, elapsed_ms, str(device))
