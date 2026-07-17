"""core/llm.py — LLM factory đa provider + registry model.

Provider: "ollama" (local), "anthropic" (Claude), "openai" (OpenAI-compatible).
Import provider lazily để môi trường chưa cài gói vẫn chạy Ollama được.
"""
from __future__ import annotations

from typing import AsyncIterator, Iterator

from langchain_core.language_models.chat_models import BaseChatModel

from backend.app.core.config import settings

# provider -> list[(model_id, label)]
MODEL_REGISTRY: dict[str, list[tuple[str, str]]] = {
    "anthropic": [
        ("claude-opus-4-8", "Claude Opus 4.8"),
        ("claude-sonnet-5", "Claude Sonnet 5"),
        ("claude-haiku-4-5-20251001", "Claude Haiku 4.5"),
    ],
    "openai": [
        ("gpt-4.1-mini", "GPT-4.1 mini"),
        ("gpt-4o", "GPT-4o"),
        ("gpt-4o-mini", "GPT-4o mini"),
    ],
}


def _content_text(content) -> str:
    """Normalize LangChain message content into a plain string.

    Anthropic (and some other providers) may return `content` as a list of
    content-block dicts (e.g. [{"type": "text", "text": "..."}]) instead of a
    plain string. Flatten that into text so callers always get a str.
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                parts.append(block.get("text", ""))
        return "".join(parts)
    return ""


def get_llm(
    provider: str | None = None,
    model: str | None = None,
    temperature: float = 0.1,
) -> BaseChatModel:
    provider = (provider or settings.DEFAULT_PROVIDER).lower()

    if provider == "ollama":
        from langchain_ollama import ChatOllama
        return ChatOllama(
            model=model or settings.OLLAMA_MODEL,
            base_url=settings.OLLAMA_URL,
            temperature=temperature,
            num_gpu=settings.LLM_NUM_GPU,
        )

    if provider == "anthropic":
        if not settings.ANTHROPIC_API_KEY:
            raise ValueError("ANTHROPIC_API_KEY chưa cấu hình — không dùng được Claude.")
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            model=model or "claude-sonnet-5",
            api_key=settings.ANTHROPIC_API_KEY,
            temperature=temperature,
        )

    if provider == "openai":
        if not settings.OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY chưa cấu hình — không dùng được OpenAI.")
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            model=model or "gpt-4o-mini",
            api_key=settings.OPENAI_API_KEY,
            base_url=settings.OPENAI_BASE_URL,
            temperature=temperature,
        )

    raise ValueError(f"Provider không hỗ trợ: {provider!r}")


def available_models() -> list[dict]:
    """Danh sách model chọn được — CHỈ provider đã cấu hình key."""
    out: list[dict] = [
        {
            "provider": "ollama",
            "model": settings.OLLAMA_MODEL,
            "label": f"{settings.OLLAMA_MODEL} (local)",
        }
    ]
    if settings.ANTHROPIC_API_KEY:
        for model_id, label in MODEL_REGISTRY["anthropic"]:
            out.append({"provider": "anthropic", "model": model_id, "label": label})
    if settings.OPENAI_API_KEY:
        for model_id, label in MODEL_REGISTRY["openai"]:
            out.append({"provider": "openai", "model": model_id, "label": label})
    return out


def _to_lc_messages(messages: list[dict], system: str = ""):
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
    out = []
    if system:
        out.append(SystemMessage(content=system))
    for m in messages:
        role = m.get("role", "user")
        content = m.get("content", "")
        if role == "system":
            out.append(SystemMessage(content=content))
        elif role == "assistant":
            out.append(AIMessage(content=content))
        else:
            out.append(HumanMessage(content=content))
    return out


async def astream_chat(
    messages: list[dict],
    system: str = "",
    provider: str | None = None,
    model: str | None = None,
    temperature: float = 0.1,
) -> AsyncIterator[str]:
    llm = get_llm(provider, model, temperature)
    async for chunk in llm.astream(_to_lc_messages(messages, system)):
        token = _content_text(chunk.content)
        if token:
            yield token


def stream_chat(
    messages: list[dict],
    system: str = "",
    provider: str | None = None,
    model: str | None = None,
    temperature: float = 0.1,
) -> Iterator[str]:
    llm = get_llm(provider, model, temperature)
    for chunk in llm.stream(_to_lc_messages(messages, system)):
        token = _content_text(chunk.content)
        if token:
            yield token


def invoke_chat(
    prompt: str,
    system: str = "",
    provider: str | None = None,
    model: str | None = None,
    temperature: float = 0.1,
) -> str:
    llm = get_llm(provider, model, temperature)
    return _content_text(llm.invoke(_to_lc_messages([{"role": "user", "content": prompt}], system)).content)
