"""Compatibility imports for the legacy LLM module."""

from backend.app.core.llm import (
    astream_chat,
    available_models,
    get_llm,
    invoke_chat,
    stream_chat,
)

__all__ = ["astream_chat", "available_models", "get_llm", "invoke_chat", "stream_chat"]
