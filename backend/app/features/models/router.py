"""api_models.py — liệt kê model LLM khả dụng cho frontend."""
from fastapi import APIRouter, Request

from backend.app.core.auth import guest_model, is_guest
from backend.app.core.config import settings
from backend.app.core.llm import available_models

router = APIRouter(tags=["models"])


@router.get("/api/models")
async def list_models(request: Request):
    models = available_models()
    if is_guest(request):
        # A guest runs on one model, whatever it picks (core/auth.py): offer
        # just that one so the picker doesn't promise a choice.
        provider, model = guest_model()
        entry = next(
            (m for m in models if m["provider"] == provider and m["model"] == model),
            {"provider": provider, "model": model, "label": model},
        )
        return {"models": [entry], "default": {"provider": provider, "model": model}}
    if settings.DEFAULT_MODEL:
        default = {"provider": settings.DEFAULT_PROVIDER, "model": settings.DEFAULT_MODEL}
    elif models:
        default = {"provider": models[0]["provider"], "model": models[0]["model"]}
    else:
        default = {"provider": "ollama", "model": settings.OLLAMA_MODEL}

    # Validate: the tentative default must actually be one of the available
    # models (e.g. DEFAULT_MODEL may point at a provider whose API key is
    # missing). If not, fall back to a real, available option.
    is_available = any(
        m["provider"] == default["provider"] and m["model"] == default["model"]
        for m in models
    )
    if not is_available:
        if models:
            default = {"provider": models[0]["provider"], "model": models[0]["model"]}
        else:
            default = {"provider": "ollama", "model": settings.OLLAMA_MODEL}

    return {"models": models, "default": default}
