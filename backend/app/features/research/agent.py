import hashlib
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Generator

from backend.app.core.config import settings
from backend.app.features.research.iteration import needs_iteration, gap_query
from backend.app.features.research.models import ResearchOutput, SearchResult
from backend.app.features.research.search import (
    ArxivSearcher,
    GitHubSearcher,
    HuggingFaceSearcher,
    OpenAlexSearcher,
    SemanticScholarSearcher,
    WebSearcher,
    WikipediaSearcher,
    # New helpers
    expand_query,
    get_dynamic_k,
    rerank_results,
    _enrich_web_results,
)
from backend.app.features.research.synthesizer import Synthesizer
from backend.app.features.research.knowledge_store import get_store, deduplicate_results

logger = logging.getLogger(__name__)

# Source registry: (name, agent_attr, default_k)
_SOURCES = [
    ("web",         "web",       6),
    ("arxiv",       "arxiv",     4),
    ("huggingface", "hf",        4),
    ("github",      "github",    3),
    ("openalex",    "openalex",  4),
    ("semantic",    "semantic",  4),
    ("wiki",        "wiki",      2),
]

# Overall deadline for a round of parallel source search. A hung/slow source
# must never crash the whole run — a timeout here degrades to "whatever
# completed" rather than propagating TimeoutError up through run()/run_streaming().
_SEARCH_TIMEOUT_SECONDS = 60

_SSE_STATUS = {
    "web":         "Searching web sources…",
    "arxiv":       "Searching Arxiv papers…",
    "huggingface": "Searching HuggingFace papers…",
    "github":      "Searching GitHub repos…",
    "openalex":    "Searching OpenAlex…",
    "semantic":    "Searching Semantic Scholar…",
    "wiki":        "Fetching Wikipedia…",
}

# ─────────────────────────────────────────────────────────────────────────────
# TTL cache
# ─────────────────────────────────────────────────────────────────────────────

_CACHE_TTL_SECONDS = 3600


class _QueryCache:
    def __init__(self, ttl: int = _CACHE_TTL_SECONDS, maxsize: int = 50):
        self._ttl    = ttl
        self._max    = maxsize
        self._store: dict[str, tuple[float, list[SearchResult]]] = {}
        self._lock   = threading.Lock()

    def _key(self, query: str) -> str:
        return hashlib.md5(query.strip().lower().encode()).hexdigest()

    def get(self, query: str) -> list[SearchResult] | None:
        key = self._key(query)
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            ts, results = entry
            if time.time() - ts > self._ttl:
                del self._store[key]
                return None
            logger.info("Cache HIT for query: %s…", query[:60])
            return results

    def set(self, query: str, results: list[SearchResult]) -> None:
        key = self._key(query)
        with self._lock:
            if len(self._store) >= self._max:
                oldest = min(self._store, key=lambda k: self._store[k][0])
                del self._store[oldest]
            self._store[key] = (time.time(), results)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()


_cache = _QueryCache()


# ─────────────────────────────────────────────────────────────────────────────
# ResearchAgent
# ─────────────────────────────────────────────────────────────────────────────

class ResearchAgent:
    def __init__(self, llm=None):
        self.web      = WebSearcher()
        self.arxiv    = ArxivSearcher()
        self.wiki     = WikipediaSearcher()
        self.semantic = SemanticScholarSearcher()
        self.hf       = HuggingFaceSearcher()
        self.github   = GitHubSearcher()
        self.openalex = OpenAlexSearcher()
        self.synth    = Synthesizer(llm)
        self._pool    = ThreadPoolExecutor(max_workers=8)

    def _is_relevant(self, query: str, results: list[SearchResult]) -> bool:
        # Gate liên quan đã nằm trong KnowledgeStore.retrieve() (rerank + threshold).
        # Ở đây chỉ cần xác nhận có kết quả trả về.
        return bool(results)

    @staticmethod
    def _cancelled(cancel_event) -> bool:
        return cancel_event is not None and cancel_event.is_set()

    # ── Core search pipeline ─────────────────────────────────────────────────

    def _search_all(
        self,
        query:       str,
        dynamic_k:   dict[str, int] | None = None,
        expansions:  list[str]      | None = None,
    ) -> list[SearchResult]:
        """
        Search all sources in parallel using dynamic k.
        If expansions provided, run extra searches and merge.
        """
        cached = _cache.get(query)
        if cached is not None:
            return cached

        k_map = dynamic_k or {name: k for name, _, k in _SOURCES}
        queries = expansions or [query]

        all_results: list[SearchResult] = []
        collect_lock = threading.Lock()

        def _run_search(name: str, attr: str, q: str) -> list[SearchResult]:
            k = k_map.get(name, 4)
            return getattr(getattr(self, attr), "search")(q, k)

        futures: dict = {}
        with ThreadPoolExecutor(max_workers=10) as ex:
            for name, attr, _ in _SOURCES:
                # Primary query
                futures[ex.submit(_run_search, name, attr, query)] = (name, query)
                # Expansion queries — only for academic sources to avoid API overuse
                if len(queries) > 1 and name in ("arxiv", "semantic", "openalex"):
                    for eq in queries[1:]:
                        futures[ex.submit(_run_search, name, attr, eq)] = (name, eq)

            try:
                for future in as_completed(futures, timeout=_SEARCH_TIMEOUT_SECONDS):
                    name, q = futures[future]
                    try:
                        batch = future.result()
                        with collect_lock:
                            all_results.extend(batch)
                        logger.info("  %s [%s] → %d results", name, q[:30], len(batch))
                    except Exception as e:
                        logger.warning("Source '%s' failed: %s", name, e)
            except TimeoutError:
                logger.warning(
                    "[SEARCH] _search_all timed out after %ss — %d results collected so far",
                    _SEARCH_TIMEOUT_SECONDS, len(all_results),
                )

        _cache.set(query, all_results)
        return all_results

    def _process_pipeline(
        self,
        query:      str,
        raw_results: list[SearchResult],
        top_k:      int = 15,
    ) -> list[SearchResult]:
        """
        Post-search pipeline:
        1. Enrich web results with trafilatura
        2. Deduplicate
        3. Rerank (BGE + credibility)
        """
        # Step 1: Enrich web results
        enriched = _enrich_web_results(raw_results)

        # Step 2: Deduplicate
        deduped = deduplicate_results(enriched, threshold=0.92)

        # Step 3: Rerank → top_k
        reranked = rerank_results(query, deduped, top_k=top_k)

        logger.info(
            "Pipeline: %d raw → %d enriched → %d deduped → %d reranked",
            len(raw_results), len(enriched), len(deduped), len(reranked),
        )
        return reranked

    def _iteration_step(self, query, sources, output, synth):
        """Run one bounded extra search round targeting a grounding gap.

        Returns (new_sources, new_output), or None to stop (no gap query, or a
        non-fatal failure — caller keeps the prior output).
        """
        gq = gap_query(query, output)
        if not gq:
            return None
        try:
            extra_raw = self._search_all(gq)
            extra = self._process_pipeline(gq, extra_raw)
            combined = deduplicate_results(sources + extra, threshold=0.92)
            new_sources = rerank_results(query, combined, top_k=15)
            new_output = synth.synthesize_grounded(query, new_sources)
            return new_sources, new_output
        except Exception as e:  # noqa: BLE001 — non-fatal, keep prior output
            logger.warning("[ITERATION] round failed (non-fatal): %s", e)
            return None

    # ── Public API ───────────────────────────────────────────────────────────

    def run(self, query: str) -> ResearchOutput:
        t0 = time.time()
        logger.info("[QUERY] %s", query)

        # RAG check
        knowledge = get_store()
        try:
            retrieved = knowledge.retrieve(query)
        except Exception as e:
            logger.warning("[KNOWLEDGE] retrieve failed (non-fatal): %s", e)
            retrieved = []

        if retrieved and self._is_relevant(query, retrieved):
            logger.info("[SOURCE] Using KNOWLEDGE (%d sources)", len(retrieved))
            output = self.synth.synthesize_rag(query, retrieved)
            logger.info("[FINAL] Knowledge answer (%.1fs)", time.time() - t0)
            return output

        logger.info("[SEARCH] TRIGGERED")

        # Expand query
        expansions = expand_query(query)
        dynamic_k  = get_dynamic_k(query)

        raw     = self._search_all(query, dynamic_k, expansions)
        sources = self._process_pipeline(query, raw)

        logger.info("[SEARCH] DONE: %d final sources (%.1fs)", len(sources), time.time() - t0)

        # Store in knowledge base
        try:
            n = knowledge.add_results(query, sources)
            logger.info("[KNOWLEDGE] STORED: %d chunks", n)
        except Exception as e:
            logger.warning("[KNOWLEDGE] STORE failed (non-fatal): %s", e)

        output = self.synth.synthesize_grounded(query, sources)

        # ── Bounded gap-driven iteration (search path only) ─────────────────
        rounds = 0
        max_rounds = getattr(settings, "RESEARCH_MAX_ITERATIONS", 1)
        while needs_iteration(output, rounds, max_rounds):
            rounds += 1
            step = self._iteration_step(query, sources, output, self.synth)
            if step is None:
                break
            sources, output = step

        logger.info("[FINAL] Search answer (%.1fs)", time.time() - t0)
        return output

    def run_streaming(
        self, query: str, provider: str | None = None, model: str | None = None,
        cancel_event: threading.Event | None = None,
    ) -> Generator[dict, None, None]:
        _CANCEL = {"type": "cancelled", "message": "Đã hủy theo yêu cầu."}
        try:
            t0 = time.time()
            logger.info("[QUERY] %s", query)

            if provider or model:
                from backend.app.core.llm import get_llm
                synth = Synthesizer(get_llm(provider, model))
            else:
                synth = self.synth

            # ── RAG check ────────────────────────────────────────────────────
            knowledge = get_store()
            try:
                retrieved = knowledge.retrieve(query)
            except Exception as e:
                logger.warning("[KNOWLEDGE] retrieve failed (non-fatal): %s", e)
                retrieved = []

            if retrieved and self._is_relevant(query, retrieved):
                logger.info("[SOURCE] Using KNOWLEDGE (%d sources)", len(retrieved))
                yield {
                    "type":    "source_done",
                    "source":  "knowledge",
                    "count":   len(retrieved),
                    "cached":  True,
                }
                all_sources = retrieved

            else:
                # ── Live search ───────────────────────────────────────────────
                if self._cancelled(cancel_event):
                    yield _CANCEL
                    return

                logger.info("[SEARCH] TRIGGERED")

                # Query expansion (non-blocking yield) — use the user's
                # per-request provider/model selection when given, so
                # expansion actually reflects what they picked in the UI
                # rather than only settings.DEFAULT_PROVIDER.
                yield {"type": "status", "message": "Expanding query…", "source": "llm"}
                expansions = expand_query(query, provider=provider, model=model)
                if len(expansions) > 1:
                    yield {
                        "type":    "status",
                        "message": f"Generated {len(expansions) - 1} query expansion(s)",
                        "source":  "llm",
                    }

                dynamic_k = get_dynamic_k(query)

                # Status messages
                for name, _, _ in _SOURCES:
                    yield {"type": "status", "message": _SSE_STATUS[name], "source": name}

                # Parallel search
                collect_lock = threading.Lock()
                raw_results: list[SearchResult] = []

                futures: dict = {}
                with ThreadPoolExecutor(max_workers=10) as ex:
                    for name, attr, _ in _SOURCES:
                        k = dynamic_k.get(name, 4)
                        futures[ex.submit(
                            getattr(getattr(self, attr), "search"), query, k
                        )] = name
                        # Expansions for academic sources
                        if len(expansions) > 1 and name in ("arxiv", "semantic", "openalex"):
                            for eq in expansions[1:]:
                                futures[ex.submit(
                                    getattr(getattr(self, attr), "search"), eq, max(2, k // 2)
                                )] = f"{name}[exp]"

                    try:
                        for future in as_completed(futures, timeout=_SEARCH_TIMEOUT_SECONDS):
                            name = futures[future]
                            try:
                                batch = future.result()
                                with collect_lock:
                                    raw_results.extend(batch)
                                yield {"type": "source_done", "source": name, "count": len(batch)}
                                logger.info("Streaming '%s' → %d results", name, len(batch))
                            except Exception as e:
                                logger.warning("Streaming '%s' failed: %s", name, e)
                                yield {"type": "source_done", "source": name, "count": 0}
                    except TimeoutError:
                        logger.warning(
                            "[SEARCH] streaming search timed out after %ss — %d raw results collected so far",
                            _SEARCH_TIMEOUT_SECONDS, len(raw_results),
                        )
                        yield {
                            "type":    "status",
                            "message": "Một số nguồn tìm kiếm quá thời gian — tiếp tục với kết quả đã có.",
                            "source":  "pipeline",
                            "degraded": True,
                        }

                logger.info("[SEARCH] Raw: %d results (%.1fs)", len(raw_results), time.time() - t0)
                _cache.set(query, raw_results)

                # ── Post-processing pipeline ──────────────────────────────────
                yield {"type": "status", "message": "Enriching web content…", "source": "web"}
                enriched = _enrich_web_results(raw_results)

                yield {"type": "status", "message": "Deduplicating results…", "source": "pipeline"}
                deduped = deduplicate_results(enriched, threshold=0.92)

                yield {"type": "status", "message": "Reranking sources…", "source": "pipeline"}
                all_sources = rerank_results(query, deduped, top_k=15)

                logger.info(
                    "[PIPELINE] %d raw → %d enriched → %d deduped → %d reranked (%.1fs)",
                    len(raw_results), len(enriched), len(deduped),
                    len(all_sources), time.time() - t0,
                )

                # Store in knowledge base
                try:
                    n = knowledge.add_results(query, all_sources)
                    logger.info("[KNOWLEDGE] STORED: %d chunks", n)
                except Exception as e:
                    logger.warning("[KNOWLEDGE] STORE failed (non-fatal): %s", e)

            # ── Synthesize ────────────────────────────────────────────────────
            if self._cancelled(cancel_event):
                yield _CANCEL
                return

            yield {"type": "synthesizing", "message": "Synthesizing with AI…", "source": "llm"}

            if retrieved and self._is_relevant(query, retrieved):
                output = synth.synthesize_rag(query, all_sources)
            else:
                output = synth.synthesize_grounded(query, all_sources)

                # ── Bounded gap-driven iteration (search path only) ─────────
                rounds = 0
                max_rounds = getattr(settings, "RESEARCH_MAX_ITERATIONS", 1)
                while needs_iteration(output, rounds, max_rounds):
                    if self._cancelled(cancel_event):
                        yield _CANCEL
                        return

                    rounds += 1
                    yield {
                        "type":    "iteration",
                        "round":   rounds,
                        "message": f"Additional research (round {rounds})…",
                        "source":  "llm",
                    }
                    step = self._iteration_step(query, all_sources, output, synth)
                    if step is None:
                        break
                    all_sources, output = step

            yield {
                "type": "done",
                "data": {
                    "query":               output.query,
                    "summary_short":       output.summary_short,
                    "summary_medium":      output.summary_medium,
                    "summary_detailed":    output.summary_detailed,
                    "key_points":          output.key_points,
                    "comparison_table":    output.comparison_table,
                    "chart_data":          output.chart_data,
                    "papers":              output.papers,
                    "references":          output.references,
                    "follow_up_questions": output.follow_up_questions,
                    "claims": [
                        {
                            "text":          c.text,
                            "source_ids":    c.source_ids,
                            "evidence_type": c.evidence_type,
                        }
                        for c in output.claims
                    ],
                    "confidence":   output.confidence,
                    "limitations":  output.limitations,
                },
            }

        except Exception as e:
            logger.error("run_streaming failed: %s", e, exc_info=True)
            yield {"type": "error", "message": str(e)}

    # ── Cache / knowledge helpers ─────────────────────────────────────────────

    def clear_cache(self) -> None:
        _cache.clear()
        logger.info("Research TTL cache cleared")

    def knowledge_size(self) -> int:
        return get_store().size()

    def clear_knowledge(self) -> None:
        get_store().clear()
        logger.info("Knowledge store cleared")
