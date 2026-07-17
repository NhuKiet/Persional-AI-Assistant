"""api_models.py — liệt kê model LLM khả dụng cho frontend."""
from fastapi import APIRouter

from backend.app.core.config import settings
from backend.app.core.llm import available_models

router = APIRouter(tags=["models"])


@router.get("/api/models")
async def list_models():
    models = available_models()
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
