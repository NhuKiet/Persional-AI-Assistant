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
        ("claude-opus-5-5", "Claude Opus 5.5"),
        ("claude-sonnet-5-5", "Claude Sonnet 5.5"),
        ("claude-haiku-5-5", "Claude Haiku 5.5"),
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
    # `method` for with_structured_output; None leaves the library default.
    structured_output_method: str | None = None
    # A policy decline is retried server-side on the model Anthropic picks.
    server_side_fallback: bool = False


# Unknown models get the conservative option on every axis: assume a small
# window, assume no structured output, assume temperature works.
DEFAULT_CAPABILITIES = ModelCapabilities(
    context_window=8192, supports_structured_output=False, supports_temperature=True,
)

_LUNA_EFFORTS = ("none", "low", "medium", "high", "xhigh", "max")


def _claude(context_window: int, server_side_fallback: bool = False) -> ModelCapabilities:
    """Claude 4.7 and later answer 400 to any temperature / top_p / top_k, and
    API version 2026-10-21 removes them on every model, so none is sent.
    langchain_anthropic's default structured-output method forces a tool call,
    which Opus 5.5 and Sonnet 5.5 also refuse with a 400; json_schema uses
    native structured output instead and works on every model listed here."""
    return ModelCapabilities(
        context_window, True, False,
        structured_output_method="json_schema",
        server_side_fallback=server_side_fallback,
    )


MODEL_CAPABILITIES: dict[str, ModelCapabilities] = {
    # supports_temperature=False is measured, not assumed: langchain_openai
    # silently drops any value other than 1.0 for this model.
    "gpt-5.6-luna":  ModelCapabilities(1_050_000, True, False, _LUNA_EFFORTS),
    "gpt-4.1-mini":  ModelCapabilities(1_047_576, True, True),
    "gpt-4o":        ModelCapabilities(128_000, True, True),
    "gpt-4o-mini":   ModelCapabilities(128_000, True, True),
    # Opus 5.5 and Sonnet 5.5 can decline with stop_reason "refusal" and an
    # empty answer; Haiku 5.5 has no server-side fallback to opt into.
    "claude-opus-5-5":            _claude(1_000_000, server_side_fallback=True),
    "claude-sonnet-5-5":          _claude(1_000_000, server_side_fallback=True),
    "claude-haiku-5-5":           _claude(1_000_000),
    "claude-opus-4-8":            _claude(1_000_000),
    "claude-sonnet-5":            _claude(1_000_000),
    "claude-haiku-4-5-20251001":  _claude(200_000),
}

# langchain_anthropic sizes max_tokens from its model profiles and falls back
# to 4096 for ids it doesn't know — Sonnet 5 and every 5.5 model, at 1.4.8.
# Thinking is on by default on those and spends from the same budget, so 4096
# truncates long answers. 16K is ample within LLM_TIMEOUT.
_ANTHROPIC_MAX_TOKENS = 16_000

# `fallbacks: "default"` lets Anthropic route a decline by its category. The
# pinned SDK only types the list form, so the string goes in extra_body; the
# beta header also moves langchain onto client.beta.messages, whose types know
# the `fallback` content block marking the hand-over.
_FALLBACK_BETA = "server-side-fallback-2026-07-01"


class MissingProviderKey(ValueError):
    """A provider's API key is not configured.

    Subclasses ValueError so every existing caller that catches ValueError
    keeps working unchanged. It exists so callers can tell "this provider
    cannot be used at all" apart from "you asked for a provider that does not
    exist" without matching on the text of a translated message.
    """


class ModelNotAllowed(ValueError):
    """A client asked for a (provider, model) pair this server doesn't offer.

    The UI only ever offers `available_models()`, but provider/model arrive
    in the request body — without this check any caller could name a pricier
    model outside MODEL_REGISTRY and get_llm would build it.
    """


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
        return "claude-sonnet-5-5"
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

    # Every client gets a deadline: a provider that stops answering must end
    # the request (and free its session lock) instead of hanging it for the
    # SDK default of ~10 minutes per attempt. See LLM_TIMEOUT in config.py.
    if provider == "ollama":
        from langchain_ollama import ChatOllama
        return ChatOllama(
            model=model,
            base_url=settings.OLLAMA_URL,
            num_gpu=settings.LLM_NUM_GPU,
            client_kwargs={"timeout": settings.LLM_TIMEOUT},
            **temp_kwargs,
        )

    if provider == "anthropic":
        if not settings.ANTHROPIC_API_KEY:
            raise MissingProviderKey("ANTHROPIC_API_KEY chưa cấu hình — không dùng được Claude.")
        from langchain_anthropic import ChatAnthropic
        fallback_kwargs: dict = {}
        if capabilities_for(provider, model).server_side_fallback:
            fallback_kwargs = {
                "betas": [_FALLBACK_BETA],
                "model_kwargs": {"extra_body": {"fallbacks": "default"}},
            }
        return ChatAnthropic(
            model=model,
            max_tokens=_ANTHROPIC_MAX_TOKENS,
            api_key=settings.ANTHROPIC_API_KEY,
            default_request_timeout=settings.LLM_TIMEOUT,
            max_retries=settings.LLM_MAX_RETRIES,
            **temp_kwargs,
            **fallback_kwargs,
        )

    if not settings.OPENAI_API_KEY:
        raise MissingProviderKey("OPENAI_API_KEY chưa cấu hình — không dùng được OpenAI.")
    from langchain_openai import ChatOpenAI
    return ChatOpenAI(
        model=model,
        api_key=settings.OPENAI_API_KEY,
        base_url=settings.OPENAI_BASE_URL,
        timeout=settings.LLM_TIMEOUT,
        max_retries=settings.LLM_MAX_RETRIES,
        **temp_kwargs,
    )


def check_model_allowed(provider: str | None, model: str | None) -> None:
    """Raise ModelNotAllowed unless the pair is one GET /api/models lists, or
    the server's own default (the operator chose it in .env, so it needn't be
    in the registry). Resolves the pair the way get_llm would, so omitting
    the model can't smuggle in something get_llm would then pick."""
    requested = (provider or settings.DEFAULT_PROVIDER).lower()
    resolved = _resolve_model(requested, model)

    default_provider = settings.DEFAULT_PROVIDER.lower()
    if (requested, resolved) == (default_provider, _resolve_model(default_provider, None)):
        return
    if any(m["provider"] == requested and m["model"] == resolved for m in available_models()):
        return
    raise ModelNotAllowed(
        f"Model {requested}/{resolved} không có trong danh sách được phép — "
        "chọn một model từ GET /api/models."
    )


def available_models() -> list[dict]:
    """Danh sách model chọn được — CHỈ provider đã cấu hình (key, hoặc URL
    với Ollama). OLLAMA_URL rỗng = không có máy Ollama, như khi deploy lên
    cloud: không liệt kê thì model guard cũng từ chối luôn provider đó."""
    out: list[dict] = []
    if settings.OLLAMA_URL:
        out.append({
            "provider": "ollama",
            "model": settings.OLLAMA_MODEL,
            "label": f"{settings.OLLAMA_MODEL} (local)",
        })
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
    except MissingProviderKey as e:
        # An unusable provider belongs in the registry. An unrecognized
        # provider string does not — that is a caller error, and recording it
        # would blunt the one signal this registry exists to give.
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
