"""tools/search/query.py — phan loai query, chon k dong, mo rong query."""
import logging
import re

logger = logging.getLogger(__name__)


_ACADEMIC_KW = {
    "paper", "papers", "research", "study", "studies", "survey",
    "algorithm", "model", "architecture", "neural", "transformer",
    "dataset", "benchmark", "evaluation", "sota", "state-of-the-art",
    "arxiv", "journal", "conference", "nlp", "cv", "ml", "ai",
    "reinforcement", "diffusion", "generative", "embedding", "fine-tuning",
    "pretraining", "llm", "bert", "gpt", "training", "inference",
}

_PRACTICAL_KW = {
    "tutorial", "how to", "howto", "guide", "example", "examples",
    "install", "setup", "deploy", "use", "usage", "docs", "documentation",
    "library", "framework", "tool", "tools", "code", "implement",
    "snippet", "starter", "quickstart",
}

# Default k per source
_DEFAULT_K: dict[str, int] = {
    "web":         6,
    "arxiv":       4,
    "huggingface": 4,
    "semantic":    4,
    "duckduckgo":  4,
    "stackoverflow": 3,
}


def _classify_query(query: str) -> str:
    """Returns 'academic', 'practical', or 'general'."""
    q = query.lower()
    academic_hits  = sum(1 for kw in _ACADEMIC_KW  if kw in q)
    practical_hits = sum(1 for kw in _PRACTICAL_KW if kw in q)
    if academic_hits >= 2 or (academic_hits >= 1 and practical_hits == 0):
        return "academic"
    if practical_hits >= 2:
        return "practical"
    return "general"


def get_dynamic_k(query: str) -> dict[str, int]:
    """Return per-source k adjusted for query type."""
    qtype = _classify_query(query)
    k = dict(_DEFAULT_K)

    if qtype == "academic":
        k["arxiv"]         = 8
        k["semantic"]      = 6
        k["huggingface"]   = 5
        k["web"]           = 4
        k["duckduckgo"]    = 2
        k["stackoverflow"] = 1
        logger.info("Query type: ACADEMIC")
    elif qtype == "practical":
        k["web"]           = 8
        k["duckduckgo"]    = 6
        k["stackoverflow"] = 6
        k["arxiv"]         = 2
        k["semantic"]      = 2
        logger.info("Query type: PRACTICAL")
    else:
        logger.info("Query type: GENERAL")

    return k


# ─────────────────────────────────────────────────────────────────────────────
# Comparison intent
# ─────────────────────────────────────────────────────────────────────────────

# Comparison intent. This lived in the frontend (ResearchResult.tsx), which
# meant the backend made the comparison LLM call on every run and the UI threw
# the result away unless the query happened to contain one of these. Measured
# on 8 baseline queries: 8 calls made, 2 displayable. The decision belongs where
# the call is made.
#
# Single words are matched on word boundaries, not as substrings: `"vs" in
# "devs"` is True, and a question about what devs are building is not a
# comparison request. The Vietnamese entries are multi-word phrases, which
# cannot collide the same way, so plain containment is right for them.
# "between" is deliberately absent. On its own it is not a comparison
# request — "the relationship between attention and memory" asks for a
# mechanism, not a table — and the phrasing that does want one ("difference
# between X and Y") is already caught by "difference".
_COMPARE_WORDS = (
    "vs", "versus", "compare", "comparison", "difference", "differences",
)
_COMPARE_PHRASES = (
    "so sánh", "khác nhau", "khác gì", "ở điểm nào",
)

# No re.IGNORECASE: has_compare_intent lowercases the query before matching,
# so the flag would only invite the two to drift apart.
_COMPARE_WORD_RE = re.compile(r"\b(?:" + "|".join(_COMPARE_WORDS) + r")\b")


def has_compare_intent(query: str) -> bool:
    q = (query or "").lower()
    return bool(_COMPARE_WORD_RE.search(q)) or any(p in q for p in _COMPARE_PHRASES)


# ─────────────────────────────────────────────────────────────────────────────
# Query expansion
# ─────────────────────────────────────────────────────────────────────────────


def expand_query(query: str, provider: str | None = None, model: str | None = None) -> list[str]:
    """
    Use an LLM to generate 2-3 alternative query formulations. Returns
    [original_query, expansion1, expansion2, ...].

    `provider`/`model` default to None, which resolves to
    settings.DEFAULT_PROVIDER inside invoke_chat/get_llm — but callers that
    know the user's per-request selection (e.g. run_streaming's provider/
    model params) should pass it through so expansion actually uses the
    provider the user picked in the UI, not just whatever's globally
    configured.

    Falls back to [original_query] on ANY error — a missing API key, an
    unreachable local Ollama server, a malformed response, a network
    timeout. Query expansion is a nice-to-have helper call, never a hard
    dependency: a provider outage here must degrade to "search the
    original query" rather than fail the whole research run.
    """
    try:
        import json

        from backend.app.core.llm import invoke_chat
        from backend.app.features.research.prompts import query_expansion_prompt

        raw = invoke_chat(
            query_expansion_prompt(query), provider=provider, model=model, temperature=0.3,
        ).strip()
        raw = raw.replace("```json", "").replace("```", "").strip()

        # Find JSON array
        start = raw.find("[")
        end   = raw.rfind("]")
        if start != -1 and end != -1:
            expansions = json.loads(raw[start:end + 1])
            if isinstance(expansions, list):
                valid = [q for q in expansions if isinstance(q, str) and len(q) > 3]
                if valid:
                    result = [query] + valid[:2]
                    logger.info("Query expansion: %d alternative(s) generated", len(valid))
                    return result

    except Exception as e:
        logger.warning("Query expansion failed (non-fatal, provider unavailable?): %s", e)

    return [query]


# ─────────────────────────────────────────────────────────────────────────────
# Contextual follow-up
# ─────────────────────────────────────────────────────────────────────────────


def contextualize_query(
    query: str,
    history: list[dict] | None,
    provider: str | None = None,
    model: str | None = None,
) -> str:
    """
    Rewrite a follow-up query into a standalone one using recent conversation
    history, so pronouns/omitted context ("what about its limitations?",
    "so sánh với cái kia") resolve correctly for search + synthesis.

    `history` is a plain [{"role": "user"|"assistant", "content": str}, ...]
    list — callers are responsible for stringifying any richer stored shape
    (e.g. the full research result dict) before passing it in here.

    Falls back to the original query on empty history or ANY error — this is
    a nice-to-have rewrite, never a hard dependency.
    """
    if not history:
        return query
    try:
        from backend.app.core.llm import invoke_chat
        from backend.app.features.research.prompts import contextualize_query_prompt

        recent = history[-6:]
        convo = "\n".join(
            f"{'User' if h.get('role') == 'user' else 'Assistant'}: {str(h.get('content', ''))[:400]}"
            for h in recent
            if h.get("content")
        )
        if not convo:
            return query

        raw = invoke_chat(
            contextualize_query_prompt(convo, query), provider=provider, model=model, temperature=0.0,
        ).strip()
        raw = raw.strip("\"' \n")
        if raw and len(raw) > 3:
            if raw != query:
                logger.info("Contextualized query: %r -> %r", query, raw)
            return raw

    except Exception as e:
        logger.warning("Query contextualization failed (non-fatal): %s", e)

    return query


# ─────────────────────────────────────────────────────────────────────────────
# Reranking
# ─────────────────────────────────────────────────────────────────────────────

