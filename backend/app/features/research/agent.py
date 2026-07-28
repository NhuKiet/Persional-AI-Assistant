import hashlib
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from concurrent.futures import TimeoutError as FutureTimeoutError
from typing import Generator

from backend.app.core.config import settings
from backend.app.features.research.iteration import needs_iteration, gap_query
from backend.app.features.research.models import ResearchOutput, SearchResult
from backend.app.features.research import sufficiency
from backend.app.features.research.search import (
    ArxivSearcher,
    DuckDuckGoSearcher,
    HuggingFaceSearcher,
    SemanticScholarSearcher,
    StackOverflowSearcher,
    WebSearcher,
    # New helpers
    contextualize_query,
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
    ("web",           "web",       6),
    ("arxiv",         "arxiv",     4),
    ("huggingface",   "hf",        4),
    ("semantic",      "semantic",  4),
    ("duckduckgo",    "ddg",       4),
    ("stackoverflow", "so",        3),
]

# Overall deadline for a round of parallel source search. A hung/slow source
# must never crash the whole run — a timeout here degrades to "whatever
# completed" rather than propagating TimeoutError up through run()/run_streaming().
_SEARCH_TIMEOUT_SECONDS = 60

# Second-layer judge: submitted to the pool and polled so cancellation is
# observed WHILE the call is in flight, not just before it starts.
_JUDGE_TIMEOUT_SECONDS = getattr(settings, "RESEARCH_JUDGE_TIMEOUT_SECONDS", 20)
_JUDGE_POLL_SECONDS    = 0.1

_SSE_STATUS = {
    "web":           "Searching web sources…",
    "arxiv":         "Searching Arxiv papers…",
    "huggingface":   "Searching HuggingFace papers…",
    "semantic":      "Searching Semantic Scholar…",
    "duckduckgo":    "Searching DuckDuckGo…",
    "stackoverflow": "Searching Stack Overflow…",
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
        self.semantic = SemanticScholarSearcher()
        self.hf       = HuggingFaceSearcher()
        self.ddg      = DuckDuckGoSearcher()
        self.so       = StackOverflowSearcher()
        self.synth    = Synthesizer(llm)
        self._pool    = ThreadPoolExecutor(max_workers=8)

    @staticmethod
    def _cancelled(cancel_event) -> bool:
        return cancel_event is not None and cancel_event.is_set()

    def _run_judge(self, query, sources, synth, cancel_event):
        """Chạy tầng-2 judge sao cho HỦY được trong lúc call đang bay.

        Kiểm tra trước một lời gọi blocking thì không hủy được chính lời gọi
        đó — nên judge chạy trong pool, còn ở đây poll `cancel_event` theo
        nhịp ngắn. Future bị bỏ rơi cứ chạy nốt rồi vứt kết quả, giống cách
        `_search_all` xử lý việc đã hủy.

        Trả None nếu hủy; (sufficient, missing) nếu không. Hết giờ hoặc lỗi
        đều cho (False, None) — nghiêng về phía search thêm.
        """
        if self._cancelled(cancel_event):
            return None

        future = self._pool.submit(
            sufficiency.judge_sufficiency,
            query, sources, synth._call, synth._parse_obj,
        )
        deadline = time.time() + _JUDGE_TIMEOUT_SECONDS
        while True:
            if self._cancelled(cancel_event):
                future.cancel()
                return None
            try:
                return future.result(timeout=_JUDGE_POLL_SECONDS)
            except FutureTimeoutError:
                pass
            except Exception as e:  # noqa: BLE001
                logger.warning("[JUDGE] failed (non-fatal): %s", e)
                return False, None
            if time.time() >= deadline:
                logger.warning("[JUDGE] timed out after %ss — treating as insufficient",
                               _JUDGE_TIMEOUT_SECONDS)
                future.cancel()
                return False, None

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
        ex = ThreadPoolExecutor(max_workers=10)
        try:
            for name, attr, _ in _SOURCES:
                # Primary query
                futures[ex.submit(_run_search, name, attr, query)] = (name, query)
                # Expansion queries — only for academic sources to avoid API overuse
                if len(queries) > 1 and name in ("arxiv", "semantic"):
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
        finally:
            # wait=False + cancel_futures: a plain `with ThreadPoolExecutor()`
            # blocks on shutdown(wait=True) regardless of the TimeoutError
            # caught above, silently negating the declared timeout — stragglers
            # (e.g. Arxiv retries backing off after 429s) would keep the whole
            # call blocked for minutes. Let them die on their own instead.
            ex.shutdown(wait=False, cancel_futures=True)

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

    def _top_up(self, query: str, base_sources: list, gap_query: str) -> tuple[list, list]:
        """Search bù rồi trộn với nguồn sẵn có.

        Trả (merged_sources, newly_fetched_sources). CHỈ tập thứ hai được
        đem đi lưu — nguồn trong `base_sources` đến từ Weaviate và ghi lại
        sẽ nhân bản chunk mỗi lần hỏi tiếp về cùng chủ đề.

        Tập "mới" tính SAU merge/dedup: nguồn mới bị dedup loại vì trùng nội
        dung đã lưu thì cũng không đáng lưu.
        """
        base_ids = {s.id for s in base_sources}
        try:
            extra_raw = self._search_all(gap_query)
            extra     = self._process_pipeline(gap_query, extra_raw)
        except Exception as e:  # noqa: BLE001 — non-fatal, giữ nguyên nguồn cũ
            logger.warning("[TOP-UP] search failed (non-fatal): %s", e)
            return base_sources, []

        combined = deduplicate_results(base_sources + extra, threshold=0.92)
        merged   = rerank_results(query, combined, top_k=15)
        newly    = [s for s in merged if s.id not in base_ids]
        logger.info("[TOP-UP] %d base + %d extra → %d merged, %d new",
                    len(base_sources), len(extra), len(merged), len(newly))
        return merged, newly

    def _store_sources(self, knowledge, query: str, sources: list) -> None:
        """Ghi nguồn mới vào knowledge store. Non-fatal — lưu hỏng thì câu
        trả lời vẫn trả về bình thường, chỉ lần hỏi sau không tận dụng được.
        """
        if not sources:
            return
        try:
            n = knowledge.add_results(query, sources)
            logger.info("[KNOWLEDGE] STORED: %d chunks from %d new sources", n, len(sources))
        except Exception as e:  # noqa: BLE001
            logger.warning("[KNOWLEDGE] STORE failed (non-fatal): %s", e)

    def _iteration_step(self, query, sources, output, synth):
        """Một vòng search bù nhắm vào khoảng trống grounding.

        Trả (new_sources, new_output, newly_fetched), hoặc None để dừng.
        """
        gq = gap_query(query, output)
        if not gq:
            return None
        try:
            merged, newly = self._top_up(query, sources, gq)
            new_output = synth.synthesize_grounded(query, merged)
            return merged, new_output, newly
        except Exception as e:  # noqa: BLE001 — non-fatal, giữ output trước đó
            logger.warning("[ITERATION] round failed (non-fatal): %s", e)
            return None

    # ── Public API ───────────────────────────────────────────────────────────

    def run(self, query: str) -> ResearchOutput:
        """Đường đồng bộ, không SSE. Chỉ là một cách drain `_run_core` —
        dùng CHUNG quyết định 3 tầng (EMPTY/STALE/THIN/MAYBE + judge +
        top-up) và persistence với `run_streaming`, thay vì có logic riêng.

        Trước đây `run()` tự gọi thẳng `retrieve()` (bỏ qua freshness/
        coverage) và không lưu gì sau khi search live — hai API cho hai
        quyết định khác nhau với cùng một câu hỏi. Giờ cả hai đi qua đúng
        một chỗ.
        """
        core = self._run_core(query, provider=None, model=None, cancel_event=None, history=None)
        error_message = None
        output: ResearchOutput | None = None
        try:
            while True:
                event = next(core)
                if event.get("type") == "error":
                    error_message = event.get("message")
        except StopIteration as stop:
            output = stop.value

        if output is None:
            raise RuntimeError(error_message or f"Research failed for query: {query!r}")
        return output

    def run_streaming(
        self, query: str, provider: str | None = None, model: str | None = None,
        cancel_event: threading.Event | None = None,
        history: list[dict] | None = None,
    ) -> Generator[dict, None, None]:
        yield from self._run_core(query, provider, model, cancel_event, history)

    def _run_core(
        self, query: str, provider: str | None, model: str | None,
        cancel_event: threading.Event | None, history: list[dict] | None,
    ) -> Generator[dict, None, ResearchOutput | None]:
        """Toàn bộ luồng thật: contextualize → gate 3 tầng → judge/top-up →
        search live → synthesize → iteration → persistence → done.

        Generator's return value (lấy qua `StopIteration.value`, hoặc
        `result = yield from _run_core(...)`) là `ResearchOutput` cuối cùng
        khi thành công, `None` khi hủy/lỗi — đây là cách `run()` lấy được
        đối tượng kết quả thật thay vì dict SSE đã serialize.
        """
        _CANCEL = {"type": "cancelled", "message": "Đã hủy theo yêu cầu."}
        try:
            t0 = time.time()
            newly_fetched: list = []
            logger.info("[QUERY] %s", query)

            if provider or model:
                from backend.app.core.llm import get_llm
                synth = Synthesizer(get_llm(provider, model))
            else:
                synth = self.synth

            # ── Contextual follow-up ─────────────────────────────────────────
            # Resolve pronouns/omitted context against recent conversation
            # turns before this query drives retrieval + search + synthesis.
            # `output.query` below is set back to the user's original text so
            # the UI still shows exactly what they typed.
            original_query = query
            if history:
                query = contextualize_query(query, history, provider=provider, model=model)
                if query != original_query:
                    yield {
                        "type":    "status",
                        "message": "Resolved follow-up context…",
                        "source":  "llm",
                    }

            # ── Knowledge gate (3 tầng) ──────────────────────────────────────
            knowledge = get_store()
            use_gate  = getattr(settings, "RESEARCH_SUFFICIENCY_ENABLED", True)

            try:
                candidates = (
                    knowledge.retrieve_candidates(query) if use_gate
                    else knowledge.retrieve(query)
                )
            except Exception as e:
                logger.warning("[KNOWLEDGE] retrieve failed (non-fatal): %s", e)
                candidates = []

            state, fresh = (
                sufficiency.assess(query, candidates) if use_gate
                else ((sufficiency.MAYBE, candidates) if candidates else (sufficiency.EMPTY, []))
            )
            stored_count = len(candidates)
            fresh_count  = len(fresh)
            decision = reason = None
            rag_path = False
            all_sources: list[SearchResult] = []

            if state in (sufficiency.THIN, sufficiency.MAYBE):
                if self._cancelled(cancel_event):
                    yield _CANCEL
                    return

                if state == sufficiency.MAYBE and not use_gate:
                    # Kill switch: hành vi cũ là "retrieve có kết quả thì dùng".
                    sufficient, missing = True, None
                elif state == sufficiency.MAYBE:
                    verdict = self._run_judge(query, fresh, synth, cancel_event)
                    if verdict is None:
                        yield _CANCEL
                        return
                    sufficient, missing = verdict
                else:
                    sufficient, missing = False, None      # THIN không cần judge

                if sufficient:
                    decision, reason, rag_path = "reuse", "sufficient", True
                    all_sources = fresh
                else:
                    gap = sufficiency.anchor_gap_query(query, missing)
                    yield {"type": "status", "message": "Bổ sung nguồn còn thiếu…",
                           "source": "knowledge"}
                    all_sources, newly = self._top_up(query, fresh, gap)
                    newly_fetched.extend(newly)
                    if newly:
                        decision = "top_up"
                        reason   = "insufficient" if state == sufficiency.MAYBE else "thin"
                    else:
                        # Đã kết luận là thiếu mà không bù được → không giả vờ đủ.
                        decision, reason = "degraded", "top_up_failed"

            yield {
                "type":         "knowledge_decision",
                "decision":     decision or "search",
                "reason":       reason or state,
                "stored_count": stored_count,
                "fresh_count":  fresh_count,
                "new_count":    len(newly_fetched),
            }

            if decision is None:
                # EMPTY hoặc STALE → live search; nguồn cũ không mang vào synthesis.
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

                dynamic_k = get_dynamic_k(query)

                # Status messages
                for name, _, _ in _SOURCES:
                    yield {"type": "status", "message": _SSE_STATUS[name], "source": name}

                # Parallel search
                collect_lock = threading.Lock()
                raw_results: list[SearchResult] = []

                futures: dict = {}
                ex = ThreadPoolExecutor(max_workers=10)
                cancelled_mid_search = False
                expansions = [query]
                try:
                    # Expansion is an LLM round-trip, but only the *extra*
                    # academic queries depend on it — the searches for the
                    # user's own query don't. Kick those off first so the
                    # expansion call overlaps them instead of delaying every
                    # source by a full LLM latency.
                    exp_future = ex.submit(expand_query, query, provider=provider, model=model)

                    for name, attr, _ in _SOURCES:
                        k = dynamic_k.get(name, 4)
                        futures[ex.submit(
                            getattr(getattr(self, attr), "search"), query, k
                        )] = name

                    try:
                        expansions = exp_future.result()
                    except Exception as e:  # noqa: BLE001 — expansion is nice-to-have
                        logger.warning("[SEARCH] query expansion failed (non-fatal): %s", e)

                    if len(expansions) > 1:
                        yield {
                            "type":    "status",
                            "message": f"Generated {len(expansions) - 1} query expansion(s)",
                            "source":  "llm",
                        }
                        # Expansions for academic sources
                        for name, attr, _ in _SOURCES:
                            if name not in ("arxiv", "semantic"):
                                continue
                            k = dynamic_k.get(name, 4)
                            for eq in expansions[1:]:
                                futures[ex.submit(
                                    getattr(getattr(self, attr), "search"), eq, max(2, k // 2)
                                )] = f"{name}[exp]"

                    try:
                        for future in as_completed(futures, timeout=_SEARCH_TIMEOUT_SECONDS):
                            # Check between each completion instead of only at
                            # the top-level checkpoints — otherwise a cancel
                            # requested mid-search sits idle for up to
                            # _SEARCH_TIMEOUT_SECONDS before it's noticed, and
                            # the (expensive) synthesis phase still starts on
                            # whatever had completed by then.
                            if self._cancelled(cancel_event):
                                cancelled_mid_search = True
                                break
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
                finally:
                    # wait=False + cancel_futures: don't block the generator
                    # waiting for in-flight source calls to finish just to
                    # tear the pool down — let them die on their own instead
                    # of paying for a search whose result nobody wants anymore.
                    ex.shutdown(wait=False, cancel_futures=True)

                if cancelled_mid_search:
                    yield _CANCEL
                    return

                logger.info("[SEARCH] Raw: %d results (%.1fs)", len(raw_results), time.time() - t0)
                _cache.set(query, raw_results)

                # ── Post-processing pipeline ──────────────────────────────────
                yield {"type": "status", "message": "Enriching web content…", "source": "web"}
                enriched = _enrich_web_results(raw_results)

                yield {"type": "status", "message": "Deduplicating results…", "source": "pipeline"}
                deduped = deduplicate_results(enriched, threshold=0.92)

                yield {"type": "status", "message": "Reranking sources…", "source": "pipeline"}
                all_sources = rerank_results(query, deduped, top_k=15)
                newly_fetched.extend(all_sources)

                logger.info(
                    "[PIPELINE] %d raw → %d enriched → %d deduped → %d reranked (%.1fs)",
                    len(raw_results), len(enriched), len(deduped),
                    len(all_sources), time.time() - t0,
                )

            # ── Synthesize ────────────────────────────────────────────────────
            if self._cancelled(cancel_event):
                yield _CANCEL
                return

            yield {"type": "synthesizing", "message": "Synthesizing with AI…", "source": "llm"}

            # Embedding + writing the new sources doesn't feed synthesis — it
            # only pays off for *future* queries. Start it now so it runs under
            # the LLM calls below instead of making the user wait for it after
            # their answer is already finished. Joined before "done" is
            # emitted, so a run still ends with its sources persisted.
            dispatched  = len(newly_fetched)
            store_future = (
                self._pool.submit(self._store_sources, knowledge, query, list(newly_fetched))
                if newly_fetched else None
            )

            if rag_path:
                output = synth.synthesize_rag_grounded(query, all_sources)
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
                    all_sources, output, iteration_newly = step
                    newly_fetched.extend(iteration_newly)

            if reason == "top_up_failed":
                output.limitations.append(
                    "Không tìm được nguồn bổ sung cho phần còn thiếu — "
                    "câu trả lời dựa trên dữ liệu đã lưu và có thể chưa đầy đủ."
                )
                if output.confidence is not None:
                    output.confidence = min(output.confidence, 0.4)
                else:
                    output.confidence = 0.4

            output.query = original_query

            # ── Persistence ──────────────────────────────────────────────────
            # Một điểm duy nhất cho mỗi tập nguồn. Trước đây có HAI call site
            # (run và run_streaming), cả hai nằm trong nhánh live search và
            # chạy TRƯỚC synthesis — vừa ghi đúp khi thêm điểm lưu mới, vừa
            # bắt người dùng đợi qua phần việc không đóng góp gì cho câu trả
            # lời của họ.
            if store_future is not None:
                store_future.result()

            # Iteration có thể đã lấy thêm nguồn SAU khi lô trên được gửi đi;
            # ghi phần dôi ra, và chỉ phần dôi ra — hai lô luôn rời nhau nên
            # không nguồn nào bị ghi hai lần.
            if len(newly_fetched) > dispatched:
                self._store_sources(knowledge, query, newly_fetched[dispatched:])

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
            return output

        except Exception as e:
            logger.error("_run_core failed: %s", e, exc_info=True)
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
