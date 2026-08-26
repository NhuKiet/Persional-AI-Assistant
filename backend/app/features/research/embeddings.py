"""tools/embeddings.py — OpenAI embeddings cho knowledge store.

Lazy singleton quanh langchain-openai OpenAIEmbeddings.
"""
from __future__ import annotations

import logging
import threading

from backend.app.core import capabilities
from backend.app.core.config import settings

logger = logging.getLogger(__name__)

_backend = None
_lock = threading.Lock()


def _get_backend():
    global _backend
    if _backend is not None:
        return _backend
    with _lock:
        if _backend is not None:
            return _backend
        if not settings.OPENAI_API_KEY:
            raise RuntimeError(
                "OPENAI_API_KEY chưa cấu hình — không dùng được OpenAI embeddings."
            )
        from langchain_openai import OpenAIEmbeddings
        _backend = OpenAIEmbeddings(
            model=settings.OPENAI_EMBEDDING_MODEL,
            api_key=settings.OPENAI_API_KEY,
        )
        logger.info("OpenAI embeddings ready: %s", settings.OPENAI_EMBEDDING_MODEL)
    return _backend


def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    try:
        vectors = _get_backend().embed_documents(texts)
    except Exception as e:
        capabilities.failed(capabilities.EMBEDDINGS, f"{type(e).__name__}: {e}")
        raise
    capabilities.ok(capabilities.EMBEDDINGS)
    return vectors


def embed_query(text: str) -> list[float]:
    try:
        vector = _get_backend().embed_query(text)
    except Exception as e:
        capabilities.failed(capabilities.EMBEDDINGS, f"{type(e).__name__}: {e}")
        raise
    capabilities.ok(capabilities.EMBEDDINGS)
    return vector
