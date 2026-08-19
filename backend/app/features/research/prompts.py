"""All LLM instruction text for the research feature, in one place.

Each function builds the exact prompt string a call site used to build
inline — same wording, same interpolation, just centralized so prompt
copy can be edited without touching call/parse logic.

Shared rule blocks (LANGUAGE_RULE, GROUNDING_RULE, UNTRUSTED_GUARD) are always
appended the same way — via `_footer()` — as a standalone paragraph at the end
of the prompt, so editing one doesn't require re-threading it through every
f-string differently.
"""

from backend.app.features.research.security import UNTRUSTED_GUARD

# Shared language rule — sources are mostly in English, but the product always
# answers in Vietnamese regardless of source language.
LANGUAGE_RULE = (
    "Respond ENTIRELY in Vietnamese (Tiếng Việt), even though the sources "
    "above are in English — translate/paraphrase source content into "
    "Vietnamese, don't quote or leave English sentences untranslated. "
    "Keep proper nouns, model/paper names, and technical terms without a "
    "standard Vietnamese equivalent in their original form."
)

# Shared anti-hallucination rule — the sources are the only allowed evidence;
# gaps must be admitted, not filled in from the model's general knowledge.
GROUNDING_RULE = (
    "Base your answer ONLY on the sources provided above. Do not use prior/"
    "general knowledge to fill gaps — if the sources don't cover something, "
    "say so explicitly instead of guessing or inventing details, numbers, or "
    "citations. When stating a specific fact, figure, or claim, name the "
    "source it came from."
)


def _footer(*rules: str) -> str:
    """Join non-empty rule blocks into one trailing paragraph, consistently."""
    return "\n".join(r for r in rules if r)


# ── Deep dive (router.py) ───────────────────────────────────────────────────

DEEP_DIVE_SYSTEM = (
    "You are KiNg, a research assistant. Answer the user's question using ONLY "
    "the provided source. Be specific and cite figures/methods from the source. "
    "If the source does not contain the answer, say so plainly. "
    f"{LANGUAGE_RULE} "
    "Use clean markdown."
)


# ── Synthesizer ──────────────────────────────────────────────────────────────

def summary_short_medium_prompt(query: str, ctx: str) -> str:
    return (
        f"You are a research assistant. Based on these sources, answer: {query}\n\n"
        f"Sources:\n{ctx}\n\n"
        f"Write TWO things:\n"
        f"1. A 2-3 sentence summary starting with 'SUMMARY:' — cover the main topic and key insight\n"
        f"2. A 2-paragraph overview starting with 'OVERVIEW:' — explain context, methods, and findings\n\n"
        f"{_footer(GROUNDING_RULE, LANGUAGE_RULE)}"
    )


def summary_detailed_prompt(query: str, ctx: str) -> str:
    return (
        f"Write a comprehensive analysis (4-6 paragraphs) about: {query}\n\n"
        f"Sources:\n{ctx}\n\n"
        f"Requirements:\n"
        f"- Paragraph 1: Context and background — why this topic matters\n"
        f"- Paragraph 2-3: Core findings, methods, and key developments from the sources\n"
        f"- Paragraph 4: Specific data points, numbers, benchmarks if available\n"
        f"- Paragraph 5-6: Current trends, limitations, and future directions\n"
        f"Be specific. Cite source names when referencing data. Do not repeat yourself.\n\n"
        f"{_footer(GROUNDING_RULE, LANGUAGE_RULE)}"
    )


def key_points_prompt(query: str, ctx: str) -> str:
    return (
        f"List 8 key findings about '{query}' from these sources.\n\n"
        f"Sources:\n{ctx}\n\n"
        f"Rules:\n"
        f"- One finding per line, minimum 15 words each\n"
        f"- Start each with a dash and one tag: [FINDING] [METHOD] [DATA] [TREND] [LIMITATION] [DEFINITION]\n"
        f"- Be specific — include numbers, names, comparisons when available\n"
        f"- Do NOT repeat the same information in different words\n"
        f"Example:\n"
        f"- [FINDING] RLHF achieves better alignment than supervised fine-tuning, reducing harmful outputs by 60% in GPT-4 evaluations\n"
        f"- [DATA] DPO reduces training time by 40% compared to PPO while maintaining similar reward model performance\n"
        f"- [TREND] Diffusion models are increasingly replacing GANs for image synthesis tasks due to better mode coverage\n\n"
        f"{_footer(GROUNDING_RULE, LANGUAGE_RULE)}"
    )


def comparison_table_prompt(query: str, src_text: str) -> str:
    return (
        f"{UNTRUSTED_GUARD}\n\n"
        f"Compare these sources about '{query}'.\n\n"
        f"Sources:\n{src_text}\n\n"
        f"Return ONLY valid JSON array, nothing else:\n"
        f'[{{"source":"title","type":"web","main_claim":"one sentence","strength":"one strength","limitation":"one limitation"}}]\n\n'
        f"Write the text fields (main_claim/strength/limitation) following these rules:\n"
        f"{_footer(GROUNDING_RULE, LANGUAGE_RULE)}"
    )


def chart_data_prompt(query: str, ctx: str) -> str:
    return (
        f"Look at these sources about '{query}'.\n\n"
        f"Sources:\n{ctx}\n\n"
        f"Do you see numbers that can be compared (%, scores, counts, years)?\n"
        f'If YES, return ONLY this JSON: {{"type":"bar","title":"title","labels":["a","b"],"values":[1,2],"unit":""}}\n'
        f"If NO, reply: NO_DATA\n\n"
        f"Rules for the JSON fields (title/labels/unit) and the numbers themselves:\n"
        f"{_footer(GROUNDING_RULE, LANGUAGE_RULE)}"
    )


def follow_up_questions_prompt(query: str) -> str:
    return (
        f"Suggest 4 follow-up research questions about '{query}'.\n"
        f'Return ONLY a JSON array: ["Q1?", "Q2?", "Q3?", "Q4?"]\n\n'
        f"{_footer(LANGUAGE_RULE)}"
    )


def rag_synthesis_prompt(query: str, ctx: str) -> str:
    return (
        f"You are a knowledgeable research assistant. "
        f"Answer the following question in a clear, comprehensive way — like explaining to a colleague.\n\n"
        f"Question: {query}\n\n"
        f"Use the sources below as your knowledge base:\n{ctx}\n\n"
        f"Write a thorough answer covering: what it is, how it works, key components, benefits, limitations, and current trends. "
        f"Be specific and natural. Do not use JSON or special markers.\n\n"
        f"{_footer(GROUNDING_RULE, LANGUAGE_RULE)}"
    )


# ── Grounding (claim extraction) ────────────────────────────────────────────

def claim_extraction_prompt(query: str, numbered_sources: str) -> str:
    return (
        f"{UNTRUSTED_GUARD}\n\n"
        f"From the sources below, extract up to 8 factual claims that answer: {query}\n\n"
        f"Sources:\n{numbered_sources}\n\n"
        f'Return ONLY a JSON array. Each item: '
        f'{{"text": "the claim", "source_id": <source number>, '
        f'"evidence_type": "direct|inference|opinion|uncertain"}}\n'
        f"Use the source number that best supports each claim. Do not invent a "
        f"claim that isn't actually stated in the numbered sources.\n\n"
        f"Write the \"text\" field following this rule:\n"
        f"{_footer(LANGUAGE_RULE)}"
    )


# ── Sufficiency judge ────────────────────────────────────────────────────────

def judge_prompt(query: str, source_chunks: str) -> str:
    return (
        f"{UNTRUSTED_GUARD}\n\n"
        f"Question: {query}\n\n"
        f"Stored context:\n{source_chunks}\n\n"
        f"Does the stored context contain enough evidence to answer the "
        f"question fully and specifically?\n"
        f"Return ONLY JSON: "
        f'{{"sufficient": true|false, "missing": "what specific evidence is missing"}}'
    )


# ── Query expansion / contextualization ─────────────────────────────────────

def query_expansion_prompt(query: str) -> str:
    return (
        f'Generate 2 alternative search queries for: "{query}"\n'
        f"Rules:\n"
        f"- Each query should approach the topic from a different angle\n"
        f"- Keep queries concise (3-8 words)\n"
        f"- Use academic/technical terms when appropriate\n"
        f'Return ONLY a JSON array: ["query1", "query2"]'
    )


def contextualize_query_prompt(convo: str, query: str) -> str:
    return (
        f"Conversation so far:\n{convo}\n\n"
        f'New question: "{query}"\n\n'
        "If the new question depends on the conversation above — pronouns "
        "(\"it\", \"nó\", \"cái đó\", \"the other one\"), an implicit subject, "
        "or anything else left unsaid — rewrite it into a fully self-contained "
        "standalone question. Replace every such reference with the exact "
        "topic, model/paper name, or entity it points to in the conversation "
        "above (copy the specific name verbatim, don't generalize it into a "
        "vaguer term). Keep the original language and intent — this is a "
        "rewrite, not an answer.\n"
        "If the question is already standalone, return it unchanged.\n"
        "Return ONLY the rewritten question, nothing else."
    )
