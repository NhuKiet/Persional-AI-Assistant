from fastapi import HTTPException

from backend.app.core.llm import ModelNotAllowed, check_model_allowed


def require_allowed_model(provider: str | None, model: str | None) -> None:
    """`check_model_allowed` for route handlers: refuse with 400 and the
    reason, before any session lock, search or LLM call is started."""
    try:
        check_model_allowed(provider, model)
    except ModelNotAllowed as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
