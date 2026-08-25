"""Dump every extracted claim beside the source it cites, for qualitative reading.

Deliberately does NOT run the full pipeline: sources come from the knowledge
store (no live search) and only the grounding step runs (no 7-call synthesis).
The question being answered is "does the auditor reject correctly", which needs
real claims over real sources and nothing else.
"""
import json
import logging
import sys
import time
import warnings

warnings.filterwarnings("ignore")
logging.disable(logging.INFO)
sys.path.insert(0, ".")

from backend.app.features.research import grounding as g
from backend.app.features.research.embeddings import embed_query
from backend.app.features.research.knowledge_store import (
    _COLLECTION, _get_weaviate, _objects_to_hits, _rank_candidates,
)
from backend.app.features.research.output_schemas import Claims
from backend.app.features.research.synthesizer import Synthesizer
from weaviate.classes.query import HybridFusion, MetadataQuery

OUT = sys.argv[1]
QUERIES = [
    "Mixture of Experts là gì",
    "Cách đánh giá chất lượng hệ thống RAG",
    "Vector database nào phù hợp cho hệ thống RAG production",
]
THRESHOLD = 0.40   # wider candidate set = more claims to read per LLM call

client = _get_weaviate()
col = client.collections.get(_COLLECTION)
synth = Synthesizer()
rows = []

for q in QUERIES:
    resp = col.query.hybrid(
        query=q, vector=embed_query(q), alpha=0.5, limit=80,
        fusion_type=HybridFusion.RELATIVE_SCORE,
        query_properties=["content"], return_metadata=MetadataQuery(score=True),
    )
    now = time.time()
    sources = _rank_candidates(_objects_to_hits(resp.objects, now), THRESHOLD, now)
    if not sources:
        print(f"!! no sources for {q}")
        continue

    claims = g.extract_claims(
        q, sources,
        lambda p: synth._call(p),
        synth._parse_array,
        structured_call=lambda p: synth._call_structured(p, Claims),
    )
    claims = g.ClaimAuditor().verify(claims, sources)

    by_id = {s.id: s for s in sources}
    for c in claims:
        cited = [by_id[i] for i in c.source_ids if i in by_id]
        best, best_sup = None, 0.0
        for s in cited:
            sup = g.lexical_support(c.text, s.content)
            if sup >= best_sup:
                best, best_sup = s, sup
        # Also score against EVERY source, to separate "unsupported anywhere"
        # from "supported, but the model cited the wrong source".
        any_sup, any_src = 0.0, None
        for s in sources:
            sup = g.lexical_support(c.text, s.content)
            if sup > any_sup:
                any_sup, any_src = sup, s
        rows.append({
            "query": q,
            "claim": c.text,
            "grounded": c.grounded,
            "evidence_type": c.evidence_type,
            "support_cited": round(best_sup, 4),
            "support_best_any": round(any_sup, 4),
            "cited_ok": bool(cited),
            "src_title": best.title if best else "",
            "src_source": best.source if best else "",
            "src_text": (best.content[:900] if best else ""),
            "best_any_title": any_src.title if any_src else "",
            "best_any_text": (any_src.content[:500] if any_src else ""),
        })
    print(f"{q[:44]:46} sources={len(sources):3} claims={len(claims):3} "
          f"grounded={sum(1 for c in claims if c.grounded)}")

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(rows, f, ensure_ascii=False, indent=1)
print("written:", OUT, "| rows:", len(rows))
