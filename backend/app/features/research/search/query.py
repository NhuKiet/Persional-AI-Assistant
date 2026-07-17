"""tools/search/query.py — phan loai query, chon k dong, mo rong query."""
import logging

import httpx

from backend.app.core.config import settings

logger = logging.getLogger(__name__)

_OLLAMA_URL   = settings.OLLAMA_URL
_OLLAMA_MODEL = settings.OLLAMA_MODEL


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
    "github":      3,
    "openalex":    4,
    "semantic":    4,
    "wiki":        2,
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
        k["arxiv"]       = 8
        k["semantic"]    = 6
        k["openalex"]    = 6
        k["huggingface"] = 5
        k["web"]         = 4
        k["github"]      = 2
        logger.info("Query type: ACADEMIC")
    elif qtype == "practical":
        k["web"]         = 8
        k["github"]      = 6
        k["wiki"]        = 3
        k["arxiv"]       = 2
        k["semantic"]    = 2
        k["openalex"]    = 2
        logger.info("Query type: PRACTICAL")
    else:
        logger.info("Query type: GENERAL")

    return k


# ─────────────────────────────────────────────────────────────────────────────
# Query expansion
# ─────────────────────────────────────────────────────────────────────────────


def expand_query(query: str) -> list[str]:
    """
    Use LLM to generate 2-3 alternative query formulations.
    Returns [original_query, expansion1, expansion2, ...].
    Falls back to [original_query] on any error.

    Note: this call is deliberately pinned to the local Ollama model (cheap
    and fast) rather than the user-selected multi-model provider — query
    expansion is an internal, high-frequency helper call, not a user-facing
    generation. Out of scope for multi-model selection per the plan.
    """
    try:
        import json
        prompt = (
            f"Generate 2 alternative search queries for: \"{query}\"\n"
            f"Rules:\n"
            f"- Each query should approach the topic from a different angle\n"
            f"- Keep queries concise (3-8 words)\n"
            f"- Use academic/technical terms when appropriate\n"
            f'Return ONLY a JSON array: ["query1", "query2"]'
        )
        resp = httpx.post(
            f"{_OLLAMA_URL}/api/generate",
            json={"model": _OLLAMA_MODEL, "prompt": prompt, "stream": False},
            timeout=30,
        )
        resp.raise_for_status()
        raw = resp.json().get("response", "").strip()
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
                    logger.info("Query expansion: %s → %s", query[:50], valid)
                    return result

    except Exception as e:
        logger.warning("Query expansion failed (non-fatal): %s", e)

    return [query]


# ─────────────────────────────────────────────────────────────────────────────
# Reranking
# ─────────────────────────────────────────────────────────────────────────────

