"""SwinCoMER inference: handwritten maths image in, LaTeX out.

The model lives in a separate repository (CapstoneProject_SP25AI12) and is
installed as the `comer` package (README, HMER section — not a plain
`pip install -e`, which drags in the capstone's dev pins). Its
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

__all__ = ["Explanation", "HmerRecognizer", "Recognition", "RecognizerUnavailable", "UnknownTokens"]

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


@dataclass(frozen=True)
class Explanation:
    """Occlusion evidence for one (image, token sequence) pair.

    weights[i] is token i's evidence over the rows × cols grid, row-major,
    summing to 1 — or all zero when no_evidence[i], i.e. hiding any single
    cell barely changes the model's belief in that token.
    """

    tokens: list[str]
    token_probs: list[float]
    rows: int
    cols: int
    weights: list[list[float]]
    no_evidence: list[bool]
    elapsed_ms: int


class UnknownTokens(ValueError):
    """The LaTeX to explain holds tokens this checkpoint's vocabulary lacks.

    Teacher forcing feeds the tokens back in as ids, so there is no way to
    explain a token the model could never have emitted.
    """


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
            # The usual cause on a machine that had it working: a plain
            # `uv sync`, which removes packages absent from uv.lock — and
            # `comer` is deliberately not in it. Say so, or the operator
            # hunts for a broken install that is merely uninstalled.
            raise RecognizerUnavailable(
                f"Chưa cài package 'comer' hoặc thiếu dependency của nó ({exc.name or exc}). "
                "Xem README, mục HMER; nếu vừa chạy `uv sync` thì phải thêm --inexact"
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

    # ── Explanation ─────────────────────────────────────────────────────

    def _token_log_probs(self, imgs, ids: list[int]):
        """Teacher-forced l2r log-probability of each token, per image.

        Returns [batch, tokens]. The joint search scores its returned sequence
        with this same l2r pass, so these are the model's own numbers, not an
        approximation (design spec §2.5).
        """
        import torch

        comer = self._model.comer_model
        batch = imgs.shape[0]
        mask = torch.zeros((batch, imgs.shape[2], imgs.shape[3]), dtype=torch.bool, device=imgs.device)
        feature, feature_mask = comer.encoder(imgs, mask)
        tgt = torch.tensor([[self._vocab.SOS_IDX, *ids]], device=imgs.device).repeat(batch, 1)
        logits = comer.decoder(feature, feature_mask, tgt)
        # Row i predicts token i; the last row predicts <eos> and is dropped.
        log_probs = logits[:, :-1].log_softmax(-1)
        index = torch.tensor(ids, device=imgs.device)[None, :, None].expand(batch, -1, 1)
        return log_probs.gather(-1, index).squeeze(-1)

    def explain(self, image_bytes: bytes, tokens: list[str]) -> Explanation:
        """Which cells of the image each token rests on (occlusion.py).

        One baseline pass, then one pass per hidden cell, in small batches:
        on the 4 GB card a batch of 32 crossed into VRAM paging and ran 11×
        slower (spec §13.4).
        """
        self.ensure_loaded()

        import torch

        from backend.app.features.hmer import occlusion

        unknown = [t for t in tokens if t not in self._vocab.word2idx]
        if unknown:
            raise UnknownTokens(
                "Token không có trong từ vựng của mô hình: " + " ".join(dict.fromkeys(unknown))
            )
        ids = [self._vocab.word2idx[t] for t in tokens]

        started = time.perf_counter()
        device = next(self._model.parameters()).device
        img = self._to_tensor(image_bytes).to(device)

        try:
            with torch.no_grad():
                lp0 = self._token_log_probs(img, ids)[0]
                cells = occlusion.occlusion_batch(
                    img, occlusion.ROWS, occlusion.COLS, occlusion.background_value(img)
                )
                lp_cells = torch.cat([
                    self._token_log_probs(chunk, ids)
                    for chunk in torch.split(cells, occlusion.EXPLAIN_BATCH)
                ])
            weights, flagged = occlusion.evidence(lp0, lp_cells, occlusion.MIN_TOTAL_DROP)
        except Exception as exc:  # noqa: BLE001 - reported, not swallowed
            capabilities.failed(capabilities.HMER, f"{type(exc).__name__}: {exc}")
            raise
        finally:
            if device.type == "cuda":
                torch.cuda.empty_cache()

        capabilities.ok(capabilities.HMER)
        return Explanation(
            tokens=list(tokens),
            token_probs=[round(float(p), 4) for p in lp0.exp()],
            rows=occlusion.ROWS,
            cols=occlusion.COLS,
            weights=[[round(float(w), 4) for w in row] for row in weights],
            no_evidence=[bool(f) for f in flagged],
            elapsed_ms=int((time.perf_counter() - started) * 1000),
        )
