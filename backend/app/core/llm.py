"""LLM factory đa provider + registry model.

Provider: "ollama" (local), "anthropic" (Claude), "openai" (OpenAI-compatible).
Import provider lazily để môi trường chưa cài gói vẫn chạy Ollama được.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import AsyncIterator, Iterator

from langchain_core.language_models.chat_models import BaseChatModel

from backend.app.core import capabilities
from backend.app.core.config import settings

# provider -> list[(model_id, label)]
MODEL_REGISTRY: dict[str, list[tuple[str, str]]] = {
    "anthropic": [
        ("claude-opus-4-8", "Claude Opus 4.8"),
        ("claude-sonnet-5", "Claude Sonnet 5"),
        ("claude-haiku-4-5-20251001", "Claude Haiku 4.5"),
    ],
    "openai": [
        ("gpt-5.6-luna", "GPT-5.6 Luna"),
        ("gpt-4.1-mini", "GPT-4.1 mini"),
        ("gpt-4o", "GPT-4o"),
        ("gpt-4o-mini", "GPT-4o mini"),
    ],
}


@dataclass(frozen=True)
class ModelCapabilities:
    """What a model can actually do. Callers ask this instead of hardcoding
    limits for whichever model happened to be configured when they were
    written — see synthesizer.py, whose context budgets were sized for
    Llama3 8B and starved every larger model that followed."""
    context_window: int
    supports_structured_output: bool
    supports_temperature: bool
    reasoning_effort_levels: tuple[str, ...] = ()


# Unknown models get the conservative option on every axis: assume a small
# window, assume no structured output, assume temperature works.
DEFAULT_CAPABILITIES = ModelCapabilities(
    context_window=8192, supports_structured_output=False, supports_temperature=True,
)

_LUNA_EFFORTS = ("none", "low", "medium", "high", "xhigh", "max")

MODEL_CAPABILITIES: dict[str, ModelCapabilities] = {
    # supports_temperature=False is measured, not assumed: langchain_openai
    # silently drops any value other than 1.0 for this model.
    "gpt-5.6-luna":  ModelCapabilities(1_050_000, True, False, _LUNA_EFFORTS),
    "gpt-4.1-mini":  ModelCapabilities(1_047_576, True, True),
    "gpt-4o":        ModelCapabilities(128_000, True, True),
    "gpt-4o-mini":   ModelCapabilities(128_000, True, True),
    "claude-opus-4-8":            ModelCapabilities(200_000, True, True),
    "claude-sonnet-5":            ModelCapabilities(200_000, True, True),
    "claude-haiku-4-5-20251001":  ModelCapabilities(200_000, True, True),
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


def _default_model_for(provider: str) -> str | None:
    """settings.DEFAULT_MODEL, nhưng CHỈ khi nó thuộc về `provider`.

    DEFAULT_MODEL đi cặp với DEFAULT_PROVIDER (xem features/models/router.py):
    một id như "gpt-5.6-luna" vô nghĩa với provider "anthropic". Nên khi caller
    chọn provider khác DEFAULT_PROVIDER, trả None để get_llm rơi về default
    riêng của provider đó.
    """
    if not settings.DEFAULT_MODEL:
        return None
    if provider != settings.DEFAULT_PROVIDER.lower():
        return None
    return settings.DEFAULT_MODEL


def _resolve_model(provider: str, model: str | None) -> str:
    """The model id `get_llm` would actually use, for a given provider.

    Extracted so `capabilities_for` cannot drift from `get_llm` — the two
    answering differently is exactly how a budget gets computed for one model
    while the call is made against another.
    """
    resolved = model or _default_model_for(provider)
    if resolved:
        return resolved
    if provider == "ollama":
        return settings.OLLAMA_MODEL
    if provider == "anthropic":
        return "claude-sonnet-5"
    return "gpt-4o-mini"


def capabilities_for(
    provider: str | None = None, model: str | None = None,
) -> ModelCapabilities:
    provider = (provider or settings.DEFAULT_PROVIDER).lower()
    return MODEL_CAPABILITIES.get(_resolve_model(provider, model), DEFAULT_CAPABILITIES)


def get_llm(
    provider: str | None = None,
    model: str | None = None,
    temperature: float = 0.1,
) -> BaseChatModel:
    provider = (provider or settings.DEFAULT_PROVIDER).lower()
    if provider not in ("ollama", "anthropic", "openai"):
        raise ValueError(f"Provider không hỗ trợ: {provider!r}")
    model = _resolve_model(provider, model)

    # Reasoning models reject any temperature other than 1.0. langchain
    # currently drops the value silently for those, which works but leaves
    # MODEL_CAPABILITIES.supports_temperature describing a rule nothing
    # enforces — so the day a provider starts erroring instead of ignoring,
    # the table would already say the right thing and change nothing. Omit
    # the parameter here instead of relying on someone else to discard it.
    temp_kwargs: dict = {}
    if capabilities_for(provider, model).supports_temperature:
        temp_kwargs["temperature"] = temperature

    if provider == "ollama":
        from langchain_ollama import ChatOllama
        return ChatOllama(
            model=model,
            base_url=settings.OLLAMA_URL,
            num_gpu=settings.LLM_NUM_GPU,
            **temp_kwargs,
        )

    if provider == "anthropic":
        if not settings.ANTHROPIC_API_KEY:
            raise ValueError("ANTHROPIC_API_KEY chưa cấu hình — không dùng được Claude.")
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            model=model,
            api_key=settings.ANTHROPIC_API_KEY,
            **temp_kwargs,
        )

    if not settings.OPENAI_API_KEY:
        raise ValueError("OPENAI_API_KEY chưa cấu hình — không dùng được OpenAI.")
    from langchain_openai import ChatOpenAI
    return ChatOpenAI(
        model=model,
        api_key=settings.OPENAI_API_KEY,
        base_url=settings.OPENAI_BASE_URL,
        **temp_kwargs,
    )


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
    # get_llm raises for two unrelated reasons. A missing API key means the
    # LLM genuinely cannot be used, so it belongs in the registry. An
    # unrecognized provider string is a caller error, and recording it as a
    # provider outage would blunt the one signal this registry exists to give.
    try:
        llm = get_llm(provider, model, temperature)
    except ValueError as e:
        if "chưa cấu hình" in str(e):
            capabilities.failed(capabilities.LLM, f"{type(e).__name__}: {e}")
        raise

    try:
        result = _content_text(
            llm.invoke(_to_lc_messages([{"role": "user", "content": prompt}], system)).content
        )
    except Exception as e:
        capabilities.failed(capabilities.LLM, f"{type(e).__name__}: {e}")
        raise

    capabilities.ok(capabilities.LLM)
    return result
