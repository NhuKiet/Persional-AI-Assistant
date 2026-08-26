# Capability Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record what actually happens to the four capabilities the research pipeline silently depends on, and let an operator read that record — without changing behavior anywhere.

**Architecture:** A module-global registry in `core/capabilities.py` holds four states. The functions that actually talk to each dependency report their real outcome and are otherwise untouched — what raises today still raises, what swallows today still swallows. A boot probe seeds three of the four. Two endpoints read the registry.

**Tech Stack:** Python 3.11+, FastAPI, pytest 8.3.4, `fastapi.testclient.TestClient`.

**Spec:** `docs/superpowers/specs/2026-08-25-capability-observability-design.md`

## Global Constraints

- Python interpreter for every command: `.venv/Scripts/python.exe` (Windows, Git Bash shell). Prefix live commands with `PYTHONPATH=. PYTHONIOENCODING=utf-8`.
- Test root is `tests/` (`pyproject.toml` sets `testpaths = ["tests"]`). Backend code lives under `backend/app/`.
- Current suite: **529 passed, 17 skipped, 0 failed**. Any test that needs changing is evidence that behavior changed — investigate before editing it. The only exceptions this plan sanctions are the two contract tests named in Task 5.
- **Observation must never change control flow.** Every reporting site keeps its exact current behavior: same exceptions raised, same values returned, same handlers catching. This is the single most important constraint in the plan.
- **No pure module reports.** `grounding.py`, `sufficiency.py`, `iteration.py`, `chunking.py`, and the scoring functions in `ranking.py`/`reranker.py` stay free of registry imports.
- Existing `logger.warning` / `logger.error` calls are **kept**. The registry supplements logging, never replaces it.
- Four capability names, exact: `llm`, `embeddings`, `knowledge_store`, `reranker`. Four statuses, exact: `ok`, `degraded`, `disabled`, `unknown`.
- `last_error` is truncated to **200** characters.
- Aggregate `status` is `degraded` when **any** capability is `degraded`. `disabled` and `unknown` never degrade it.
- `/health` always returns **200**. Liveness is not capability health.
- Commit after every task. Never use `--no-verify`. Branch is `main` — work directly on it, do not push.

---

## File Structure

**Created:**
- `backend/app/core/capabilities.py` — the registry. One responsibility: hold and report four capability states. No I/O, no knowledge of who calls it.
- `tests/test_capabilities.py` — registry semantics.
- `tests/test_capability_reporting.py` — proves each boundary reports *and* preserves behavior.

**Modified:**
- `backend/app/features/research/embeddings.py` — report at `embed_texts`, `embed_query`.
- `backend/app/core/llm.py` — report at `invoke_chat`.
- `backend/app/features/research/synthesizer.py` — report at `Synthesizer._call`.
- `backend/app/features/research/knowledge_store.py` — report at the Weaviate connection block, the two hybrid-query handlers, `add_results`, and `_rerank` (for `disabled`).
- `backend/app/features/research/reranker.py` — report at `cross_encoder_scores`.
- `backend/app/core/lifespan.py` — boot probe for three capabilities.
- `backend/app/main.py` — `/health` gains a truthful `status`; `/health/capabilities` added.
- `tests/conftest.py` — autouse fixture resetting the registry between tests.
- `tests/contract/test_api_contracts.py` — `PUBLIC_ROUTES` gains the new route; the health contract test is made order-independent.

**Correction to the spec, applied here:** spec §4 lists `retrieve_candidates` / `retrieve` as `knowledge_store` reporting sites. Reading the code, both catch `_get_weaviate()` **and** `embed_query()` in one `try`, so that handler cannot tell which capability failed and would misattribute an embeddings outage to Weaviate. The spec's own boundary rule settles it: report inside `_get_weaviate` and at the hybrid-query handlers, which are unambiguously Weaviate. `embed_query` reports itself from inside `embeddings.py`.

---

### Task 1: The registry

**Files:**
- Create: `backend/app/core/capabilities.py`
- Create: `tests/test_capabilities.py`
- Modify: `tests/conftest.py`

**Interfaces:**
- Produces:
  - Constants `LLM`, `EMBEDDINGS`, `KNOWLEDGE_STORE`, `RERANKER`, tuple `CAPABILITIES`
  - Constants `OK`, `DEGRADED`, `DISABLED`, `UNKNOWN`
  - `ok(capability: str) -> None`
  - `failed(capability: str, detail: str) -> None`
  - `disabled(capability: str) -> None`
  - `snapshot() -> dict` returning `{"status": str, "capabilities": {name: {...}}}`
  - `reset() -> None`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_capabilities.py`:

```python
# tests/test_capabilities.py
import threading

import backend.app.core.capabilities as cap


def test_starts_unknown_for_every_capability():
    snap = cap.snapshot()
    assert set(snap["capabilities"]) == set(cap.CAPABILITIES)
    for state in snap["capabilities"].values():
        assert state["status"] == cap.UNKNOWN
        assert state["total_ok"] == 0
        assert state["total_failed"] == 0
        assert state["last_ok_at"] is None


def test_ok_sets_status_and_counts():
    cap.ok(cap.LLM)
    state = cap.snapshot()["capabilities"][cap.LLM]
    assert state["status"] == cap.OK
    assert state["total_ok"] == 1
    assert state["last_ok_at"] is not None


def test_failed_sets_status_error_and_counts():
    cap.failed(cap.RERANKER, "XLMRobertaTokenizer has no attribute prepare_for_model")
    state = cap.snapshot()["capabilities"][cap.RERANKER]
    assert state["status"] == cap.DEGRADED
    assert state["total_failed"] == 1
    assert state["consecutive_failures"] == 1
    assert "prepare_for_model" in state["last_error"]
    assert state["last_error_at"] is not None


def test_consecutive_failures_reset_on_success_but_totals_do_not():
    for _ in range(3):
        cap.failed(cap.EMBEDDINGS, "rate limited")
    cap.ok(cap.EMBEDDINGS)
    state = cap.snapshot()["capabilities"][cap.EMBEDDINGS]
    assert state["consecutive_failures"] == 0
    assert state["total_failed"] == 3
    assert state["total_ok"] == 1


def test_dead_capability_is_distinguishable_from_a_flaky_one():
    """The signal that would have ended the reranker outage in minutes."""
    for _ in range(50):
        cap.failed(cap.RERANKER, "cannot score")
    for _ in range(25):
        cap.failed(cap.EMBEDDINGS, "rate limited")
        cap.ok(cap.EMBEDDINGS)

    dead = cap.snapshot()["capabilities"][cap.RERANKER]
    flaky = cap.snapshot()["capabilities"][cap.EMBEDDINGS]
    assert dead["total_ok"] == 0 and dead["consecutive_failures"] == 50
    assert flaky["total_ok"] == 25 and flaky["consecutive_failures"] == 0


def test_last_error_is_truncated():
    cap.failed(cap.LLM, "x" * 500)
    assert len(cap.snapshot()["capabilities"][cap.LLM]["last_error"]) == 200


def test_disabled_survives_a_failure_report():
    """A switched-off capability reported as broken trains operators to
    dismiss warnings."""
    cap.disabled(cap.RERANKER)
    cap.failed(cap.RERANKER, "not configured")
    state = cap.snapshot()["capabilities"][cap.RERANKER]
    assert state["status"] == cap.DISABLED
    assert state["total_failed"] == 1     # still counted


def test_disabled_is_cleared_by_a_real_success():
    """Evidently it works, so it is evidently not switched off."""
    cap.disabled(cap.RERANKER)
    cap.ok(cap.RERANKER)
    assert cap.snapshot()["capabilities"][cap.RERANKER]["status"] == cap.OK


def test_aggregate_status_degrades_on_any_degraded_capability():
    assert cap.snapshot()["status"] == cap.OK
    cap.failed(cap.KNOWLEDGE_STORE, "503")
    assert cap.snapshot()["status"] == cap.DEGRADED


def test_aggregate_status_ignores_unknown_and_disabled():
    cap.disabled(cap.RERANKER)
    cap.ok(cap.LLM)
    # embeddings and knowledge_store remain unknown
    assert cap.snapshot()["status"] == cap.OK


def test_concurrent_reports_lose_no_counts():
    def report():
        for _ in range(200):
            cap.ok(cap.LLM)

    threads = [threading.Thread(target=report) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert cap.snapshot()["capabilities"][cap.LLM]["total_ok"] == 1600
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_capabilities.py -q`

Expected: FAIL — `ModuleNotFoundError: No module named 'backend.app.core.capabilities'`.

- [ ] **Step 3: Implement the registry**

Create `backend/app/core/capabilities.py`:

```python
"""What actually happened to the dependencies we otherwise cannot see fail.

The research feature holds 32 non-fatal degradation points — try/except blocks
that log a warning and continue. Each is individually right: a run must not die
because one source timed out. Together they mean every failure mode looks
identical to healthy operation from outside the process.

The clearest case: the BGE reranker was unable to score for an unknown length
of time while every startup signal reported success, because the model *loaded*
and only `compute_score` raised — an exception its caller swallowed into "fall
back to credibility". The main ranking signal of the feature was dead and
nothing in the system could say so.

This records the outcome of REAL calls rather than synthetic probes. Every
outage found in August 2026 was visible only when real data went through: a
probe embedding of "healthcheck" succeeds while a real batch of 32 chunks
fails on a rate limit, and a reranker loads fine while being unable to score.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass

LLM = "llm"
EMBEDDINGS = "embeddings"
KNOWLEDGE_STORE = "knowledge_store"
RERANKER = "reranker"

CAPABILITIES = (LLM, EMBEDDINGS, KNOWLEDGE_STORE, RERANKER)

OK = "ok"
DEGRADED = "degraded"
DISABLED = "disabled"
UNKNOWN = "unknown"

_MAX_ERROR_CHARS = 200


@dataclass
class _State:
    status: str = UNKNOWN
    consecutive_failures: int = 0
    total_ok: int = 0
    total_failed: int = 0
    last_error: str = ""
    last_error_at: float | None = None
    last_ok_at: float | None = None


_lock = threading.Lock()
_states: dict[str, _State] = {name: _State() for name in CAPABILITIES}


def ok(capability: str) -> None:
    """A real call to this dependency succeeded."""
    with _lock:
        s = _states[capability]
        s.status = OK
        s.consecutive_failures = 0
        s.total_ok += 1
        s.last_ok_at = time.time()


def failed(capability: str, detail: str) -> None:
    """A real call to this dependency failed.

    A capability explicitly marked `disabled` keeps that status — the failure
    is still counted, but an operator who switched something off should not be
    told it is broken.
    """
    with _lock:
        s = _states[capability]
        if s.status != DISABLED:
            s.status = DEGRADED
        s.consecutive_failures += 1
        s.total_failed += 1
        s.last_error = str(detail)[:_MAX_ERROR_CHARS]
        s.last_error_at = time.time()


def disabled(capability: str) -> None:
    """Switched off by configuration. Distinct from degraded on purpose:
    reporting a deliberately disabled capability as broken is worse than
    silence, because it teaches operators to dismiss warnings."""
    with _lock:
        _states[capability].status = DISABLED


def snapshot() -> dict:
    """Current state plus the aggregate. Computed here so both health
    endpoints read one rule rather than each deriving it."""
    with _lock:
        caps = {
            name: {
                "status": s.status,
                "consecutive_failures": s.consecutive_failures,
                "total_ok": s.total_ok,
                "total_failed": s.total_failed,
                "last_error": s.last_error,
                "last_error_at": s.last_error_at,
                "last_ok_at": s.last_ok_at,
            }
            for name, s in _states.items()
        }
    aggregate = DEGRADED if any(c["status"] == DEGRADED for c in caps.values()) else OK
    return {"status": aggregate, "capabilities": caps}


def reset() -> None:
    """Test hook. This registry is module-global, so without a reset between
    tests one test's reported failure leaks into another's assertions — and
    the leak would depend on test order, which is the worst kind."""
    with _lock:
        for name in CAPABILITIES:
            _states[name] = _State()
```

- [ ] **Step 4: Add the test isolation fixture**

Append to `tests/conftest.py`:

```python
@pytest.fixture(autouse=True)
def _reset_capability_registry():
    """The capability registry is module-global. Without this, a test that
    reports a failure changes what a later test observes, and which later test
    depends on collection order."""
    from backend.app.core import capabilities

    capabilities.reset()
    yield
    capabilities.reset()
```

`tests/conftest.py` already imports `pytest` and already defines autouse fixtures, so this appends to an existing pattern — no new imports needed.

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_capabilities.py -q`

Expected: PASS, 11 tests.

Then the full suite: `.venv/Scripts/python.exe -m pytest tests -q`

Expected: 529 passed, 17 skipped, 0 failed — unchanged, since nothing reports yet.

- [ ] **Step 6: Commit**

```bash
git add backend/app/core/capabilities.py tests/test_capabilities.py tests/conftest.py
git commit -m "feat(core): add capability registry"
```

---

### Task 2: Boundaries that raise

`embed_texts`, `embed_query` and `invoke_chat` propagate their exceptions to callers today. They must keep doing exactly that.

**Files:**
- Modify: `backend/app/features/research/embeddings.py`
- Modify: `backend/app/core/llm.py`
- Create: `tests/test_capability_reporting.py`

**Interfaces:**
- Consumes: `capabilities.ok`, `capabilities.failed`, `capabilities.EMBEDDINGS`, `capabilities.LLM` (Task 1).
- Produces: no new public API. `embed_texts`, `embed_query`, `invoke_chat` keep their exact signatures and behavior.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_capability_reporting.py`:

```python
# tests/test_capability_reporting.py
"""Each boundary must report AND keep its exact current behavior.

The behavior half matters more than the reporting half: adding observability
that quietly changes control flow would introduce the very class of bug this
work exists to catch.
"""
import pytest

import backend.app.core.capabilities as cap


# ── embeddings: raise to caller ──────────────────────────────────────────────

def test_embed_texts_reports_ok(monkeypatch):
    import backend.app.features.research.embeddings as emb

    monkeypatch.setattr(emb, "_get_backend", lambda: type(
        "B", (), {"embed_documents": lambda self, t: [[0.1]] * len(t)}
    )())
    assert emb.embed_texts(["a", "b"]) == [[0.1], [0.1]]
    assert cap.snapshot()["capabilities"][cap.EMBEDDINGS]["status"] == cap.OK


def test_embed_texts_reports_failure_and_reraises(monkeypatch):
    import backend.app.features.research.embeddings as emb

    class _Boom:
        def embed_documents(self, texts):
            raise RuntimeError("rate limited")

    monkeypatch.setattr(emb, "_get_backend", lambda: _Boom())

    with pytest.raises(RuntimeError, match="rate limited"):
        emb.embed_texts(["a"])

    state = cap.snapshot()["capabilities"][cap.EMBEDDINGS]
    assert state["status"] == cap.DEGRADED
    assert "rate limited" in state["last_error"]


def test_embed_texts_empty_input_reports_nothing(monkeypatch):
    """No call was made, so there is nothing to observe."""
    import backend.app.features.research.embeddings as emb

    assert emb.embed_texts([]) == []
    state = cap.snapshot()["capabilities"][cap.EMBEDDINGS]
    assert state["status"] == cap.UNKNOWN
    assert state["total_ok"] == 0


def test_embed_query_reports_failure_and_reraises(monkeypatch):
    import backend.app.features.research.embeddings as emb

    class _Boom:
        def embed_query(self, text):
            raise RuntimeError("no api key")

    monkeypatch.setattr(emb, "_get_backend", lambda: _Boom())

    with pytest.raises(RuntimeError, match="no api key"):
        emb.embed_query("q")
    assert cap.snapshot()["capabilities"][cap.EMBEDDINGS]["status"] == cap.DEGRADED


# ── llm: invoke_chat raises to caller ────────────────────────────────────────

def test_invoke_chat_reports_ok(monkeypatch):
    import backend.app.core.llm as llm_mod

    class _R:
        content = "hello"

    monkeypatch.setattr(llm_mod, "get_llm",
                        lambda *a, **k: type("L", (), {"invoke": lambda self, m: _R()})())
    assert llm_mod.invoke_chat("p") == "hello"
    assert cap.snapshot()["capabilities"][cap.LLM]["status"] == cap.OK


def test_invoke_chat_reports_failure_and_reraises(monkeypatch):
    import backend.app.core.llm as llm_mod

    def _boom(*a, **k):
        raise RuntimeError("provider down")

    monkeypatch.setattr(llm_mod, "get_llm", _boom)

    with pytest.raises(RuntimeError, match="provider down"):
        llm_mod.invoke_chat("p")
    assert cap.snapshot()["capabilities"][cap.LLM]["status"] == cap.DEGRADED
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_capability_reporting.py -q`

Expected: FAIL — the status assertions fail because nothing reports yet (the behavior assertions already pass, which is the point).

- [ ] **Step 3: Report from embeddings**

In `backend/app/features/research/embeddings.py`, add the import at the top:

```python
from backend.app.core import capabilities
```

Replace both public functions:

```python
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
```

The bare `raise` re-raises the original exception with its traceback intact — callers see exactly what they saw before.

- [ ] **Step 4: Report from invoke_chat**

In `backend/app/core/llm.py`, add near the other imports:

```python
from backend.app.core import capabilities
```

Replace `invoke_chat`:

```python
def invoke_chat(
    prompt: str,
    system: str = "",
    provider: str | None = None,
    model: str | None = None,
    temperature: float = 0.1,
) -> str:
    try:
        llm = get_llm(provider, model, temperature)
        result = _content_text(
            llm.invoke(_to_lc_messages([{"role": "user", "content": prompt}], system)).content
        )
    except Exception as e:
        capabilities.failed(capabilities.LLM, f"{type(e).__name__}: {e}")
        raise
    capabilities.ok(capabilities.LLM)
    return result
```

- [ ] **Step 5: Run tests**

Run: `.venv/Scripts/python.exe -m pytest tests/test_capability_reporting.py -q`

Expected: PASS, 6 tests.

Then the full suite: `.venv/Scripts/python.exe -m pytest tests -q`

Expected: 529 passed + the 6 new, 17 skipped, 0 failed.

- [ ] **Step 6: Commit**

```bash
git add backend/app/features/research/embeddings.py backend/app/core/llm.py tests/test_capability_reporting.py
git commit -m "feat(core): report embeddings and llm outcomes at the raising boundaries"
```

---

### Task 3: Boundaries that swallow

`Synthesizer._call`, the Weaviate handlers, and `cross_encoder_scores` catch their own exceptions and return a fallback value. They must keep returning exactly that.

**Files:**
- Modify: `backend/app/features/research/synthesizer.py`
- Modify: `backend/app/features/research/knowledge_store.py`
- Modify: `backend/app/features/research/reranker.py`
- Modify: `tests/test_capability_reporting.py`

**Interfaces:**
- Consumes: `capabilities.ok`, `capabilities.failed`, `capabilities.disabled`, `capabilities.LLM`, `capabilities.KNOWLEDGE_STORE`, `capabilities.RERANKER` (Task 1).
- Produces: no new public API. `_call` still returns `""` on failure; `cross_encoder_scores` still returns `None`; the Weaviate methods still return `[]`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_capability_reporting.py`:

```python
# ── llm: Synthesizer._call swallows ──────────────────────────────────────────

def _synth():
    from backend.app.core.llm import ModelCapabilities
    from backend.app.features.research.synthesizer import Synthesizer

    class _LLM:
        def invoke(self, prompt):
            raise RuntimeError("provider down")

    return Synthesizer(llm=_LLM(), capabilities=ModelCapabilities(8192, False, True))


def test_call_still_returns_empty_string_on_failure():
    s = _synth()
    assert s._call("p") == ""
    assert cap.snapshot()["capabilities"][cap.LLM]["status"] == cap.DEGRADED


def test_call_reports_ok_on_success():
    from backend.app.core.llm import ModelCapabilities
    from backend.app.features.research.synthesizer import Synthesizer

    class _R:
        content = "text"

    class _LLM:
        def invoke(self, prompt):
            return _R()

    s = Synthesizer(llm=_LLM(), capabilities=ModelCapabilities(8192, False, True))
    assert s._call("p") == "text"
    assert cap.snapshot()["capabilities"][cap.LLM]["status"] == cap.OK


# ── reranker: cross_encoder_scores swallows ──────────────────────────────────

def test_cross_encoder_reports_ok_when_it_scores(monkeypatch):
    import backend.app.features.research.reranker as rr

    monkeypatch.setattr(rr.settings, "COHERE_API_KEY", None, raising=False)
    monkeypatch.setattr(rr, "_bge_reranker", lambda: type(
        "M", (), {"predict": lambda self, pairs: [0.5] * len(pairs)}
    )())

    assert rr.cross_encoder_scores("q", ["d"]) == [0.5]
    assert cap.snapshot()["capabilities"][cap.RERANKER]["status"] == cap.OK


def test_cross_encoder_reports_degraded_and_still_returns_none(monkeypatch):
    import backend.app.features.research.reranker as rr

    monkeypatch.setattr(rr.settings, "COHERE_API_KEY", None, raising=False)
    monkeypatch.setattr(rr, "_bge_reranker", lambda: None)

    assert rr.cross_encoder_scores("q", ["d"]) is None
    assert cap.snapshot()["capabilities"][cap.RERANKER]["status"] == cap.DEGRADED


def test_cross_encoder_empty_docs_reports_nothing(monkeypatch):
    """Returns None because there was nothing to do — not a failure."""
    import backend.app.features.research.reranker as rr

    assert rr.cross_encoder_scores("q", []) is None
    state = cap.snapshot()["capabilities"][cap.RERANKER]
    assert state["status"] == cap.UNKNOWN
    assert state["total_failed"] == 0


# ── knowledge store: handlers swallow ────────────────────────────────────────

def test_knowledge_store_reports_degraded_and_still_returns_empty(monkeypatch):
    import backend.app.features.research.knowledge_store as ks

    def _boom():
        raise RuntimeError("Meta endpoint! Unexpected status code: 503")

    monkeypatch.setattr(ks, "_get_weaviate", _boom)

    assert ks.KnowledgeStore().retrieve_candidates("q") == []
    assert cap.snapshot()["capabilities"][cap.KNOWLEDGE_STORE]["status"] == cap.DEGRADED
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_capability_reporting.py -q`

Expected: FAIL on the new status assertions; the return-value assertions already pass.

- [ ] **Step 3: Report from `Synthesizer._call`**

In `backend/app/features/research/synthesizer.py`, add to the imports:

```python
from backend.app.core import capabilities
```

Replace `_call`:

```python
    def _call(self, prompt: str, effort: str | None = None) -> str:
        try:
            result = _content_or_str(self._bound(effort).invoke(prompt).content)
        except Exception as e:
            capabilities.failed(capabilities.LLM, f"{type(e).__name__}: {e}")
            logger.error("LLM call failed: %s", e)
            return ""
        capabilities.ok(capabilities.LLM)
        logger.info("LLM response: %d chars", len(result))
        logger.debug("LLM (%d chars): %s…", len(result), result[:80])
        return result
```

`_call_structured` is deliberately left alone: it fails mainly on schema violations rather than provider outages, and it already falls back to `_call`, which reports if the provider is genuinely down.

- [ ] **Step 4: Report from `cross_encoder_scores`**

In `backend/app/features/research/reranker.py`, add to the imports:

```python
from backend.app.core import capabilities
```

Replace `cross_encoder_scores`:

```python
def cross_encoder_scores(query: str, docs: list[str]) -> list[float] | None:
    """Điểm liên quan [0,1] cho từng doc, hoặc None nếu không có backend nào."""
    if not docs:
        # Nothing to score is not a failure — reporting here would inflate
        # total_failed with calls that had no work to do.
        return None
    scores = _cohere_scores(query, docs) or _bge_scores(query, docs)
    if scores is None:
        capabilities.failed(capabilities.RERANKER, "no reranker backend produced scores")
    else:
        capabilities.ok(capabilities.RERANKER)
    return scores
```

- [ ] **Step 5: Report from the knowledge store**

In `backend/app/features/research/knowledge_store.py`, add to the imports:

```python
from backend.app.core import capabilities
```

In `_get_weaviate`, wrap the connection block so a 503 is attributed at the boundary. Replace the body after the double-checked lock:

```python
        if not settings.WEAVIATE_URL or not settings.WEAVIATE_API_KEY:
            raise RuntimeError("WEAVIATE_URL / WEAVIATE_API_KEY chưa cấu hình.")
        import weaviate
        from weaviate.classes.init import Auth
        try:
            client = weaviate.connect_to_weaviate_cloud(
                cluster_url=settings.WEAVIATE_URL,
                auth_credentials=Auth.api_key(settings.WEAVIATE_API_KEY),
            )
            _ensure_schema(client)
        except Exception as e:
            capabilities.failed(capabilities.KNOWLEDGE_STORE, f"{type(e).__name__}: {e}")
            raise
        _client = client
        logger.info("Weaviate connected: %s", settings.WEAVIATE_URL)
    return _client
```

In `retrieve_candidates`, report from the first handler — it catches `_get_weaviate()` and `embed_query()` together and cannot attribute, so it reports the *store* only when the store is the one that failed. Replace that handler:

```python
        try:
            client = _get_weaviate()
            q_vec  = embed_query(query)
        except Exception as e:
            # Not attributed here: _get_weaviate and embed_query each report
            # from their own boundary, where the cause is unambiguous.
            logger.warning("retrieve_candidates skipped: %s", e)
            return []
```

That handler therefore reports nothing — the two boundaries inside it already did. Apply the same comment to the identical handler in `retrieve`.

Report at the two hybrid-query handlers, which are unambiguously Weaviate. In **both** `retrieve` and `retrieve_candidates`, replace:

```python
        except Exception as e:
            capabilities.failed(capabilities.KNOWLEDGE_STORE, f"{type(e).__name__}: {e}")
            logger.warning("Weaviate hybrid query failed (non-fatal): %s", e)
            return []
```

and add a success report immediately after each successful `col.query.hybrid(...)` block:

```python
        capabilities.ok(capabilities.KNOWLEDGE_STORE)
```

In `add_results`, replace the connection handler:

```python
        try:
            client = _get_weaviate()
        except Exception as e:
            logger.warning("KnowledgeStore add skipped (Weaviate unavailable): %s", e)
            return 0
```

leaving it unreported for the same reason — `_get_weaviate` already reported.

In `_rerank`, report the configuration state:

```python
    try:
        if _RERANK_ENABLED:
            rerank = cross_encoder_scores(query, [r.content[:1000] for r in candidates])
        else:
            capabilities.disabled(capabilities.RERANKER)
            rerank = None
    except Exception as e:
        logger.warning("cross_encoder_scores failed (non-fatal): %s", e)
        rerank = None
```

- [ ] **Step 6: Run tests**

Run: `.venv/Scripts/python.exe -m pytest tests/test_capability_reporting.py -q`

Expected: PASS, 12 tests.

Then the full suite: `.venv/Scripts/python.exe -m pytest tests -q`

Expected: 529 passed + 12 new, 17 skipped, 0 failed.

- [ ] **Step 7: Commit**

```bash
git add backend/app/features/research/synthesizer.py backend/app/features/research/knowledge_store.py backend/app/features/research/reranker.py tests/test_capability_reporting.py
git commit -m "feat(research): report outcomes at the swallowing boundaries"
```

---

### Task 4: Boot seeding

**Files:**
- Modify: `backend/app/core/lifespan.py`

**Interfaces:**
- Consumes: `capabilities` (Task 1), `reranker_selfcheck` (already exists), `embed_query`, `get_store`.
- Produces: `_seed_capabilities()` — a module-level function in `lifespan.py`, called from the existing background thread.

- [ ] **Step 1: Replace the warm thread with a seeding probe**

In `backend/app/core/lifespan.py`, replace the `_warm_reranker` function and its thread with:

```python
    def _seed_capabilities():
        """One probe per capability so the registry is not all-unknown before
        the first request.

        The LLM is deliberately not probed: it is the only one of the four
        whose probe costs a real billed completion on every start, which under
        --reload is every file save. What that buys is small — the first
        research request arrives seconds later and reports the provider's true
        state under real load. The common configuration failure, a missing API
        key, already raises loudly from get_llm and is not in the silent class
        this registry exists to catch.
        """
        from backend.app.features.research.reranker import reranker_selfcheck
        from backend.app.features.research.embeddings import embed_query
        from backend.app.features.research.knowledge_store import get_store

        problem = reranker_selfcheck()
        if problem:
            capabilities.failed(capabilities.RERANKER, problem)
            logger.error(
                "Cross-encoder reranking is NOT working (%s) — research will "
                "rank by credibility only. Check RERANKER_MODEL, the "
                "sentence-transformers/transformers versions, or set "
                "COHERE_API_KEY to use the hosted reranker instead.",
                problem,
            )
        else:
            capabilities.ok(capabilities.RERANKER)

        # Both of these report from their own boundaries; the try/except here
        # exists only so a probe failure cannot kill the startup thread.
        try:
            embed_query("healthcheck")
        except Exception as e:
            logger.warning("Embeddings probe failed at boot: %s", e)

        try:
            get_store().size()
        except Exception as e:
            logger.warning("Knowledge store probe failed at boot: %s", e)

        snap = capabilities.snapshot()
        if snap["status"] != capabilities.OK:
            degraded = [n for n, c in snap["capabilities"].items()
                        if c["status"] == capabilities.DEGRADED]
            logger.error("Capabilities degraded at boot: %s", ", ".join(degraded))

    threading.Thread(target=_seed_capabilities, daemon=True).start()
```

Add to the imports at the top of `lifespan.py`:

```python
from backend.app.core import capabilities
```

Note `get_store().size()` already catches its own exception and returns 0, so the outer `try` there is belt-and-braces; keep it, because `get_store()` itself can raise.

- [ ] **Step 2: Verify the probe runs and reports**

Run:

```bash
PYTHONPATH=. PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe -c "
import warnings, logging; warnings.filterwarnings('ignore'); logging.disable(logging.WARNING)
from backend.app.core import capabilities
from backend.app.features.research.reranker import reranker_selfcheck
from backend.app.features.research.embeddings import embed_query
from backend.app.features.research.knowledge_store import get_store
print('reranker:', reranker_selfcheck() or 'ok')
try: embed_query('healthcheck')
except Exception as e: print('embeddings probe failed:', e)
try: get_store().size()
except Exception as e: print('store probe failed:', e)
import json; print(json.dumps(capabilities.snapshot()['capabilities'], indent=1, default=str))
"
```

Expected: `reranker: ok`, and `embeddings` / `knowledge_store` showing `status: "ok"` with `total_ok: 1`. `llm` stays `unknown` — that is the designed behavior, not a bug.

- [ ] **Step 3: Run the suite**

Run: `.venv/Scripts/python.exe -m pytest tests -q`

Expected: unchanged pass count, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add backend/app/core/lifespan.py
git commit -m "feat(core): seed the capability registry at boot"
```

---

### Task 5: The endpoints

**Files:**
- Modify: `backend/app/main.py`
- Modify: `tests/contract/test_api_contracts.py`
- Create: `tests/test_health_endpoints.py`

**Interfaces:**
- Consumes: `capabilities.snapshot()` (Task 1).
- Produces: `GET /health` returning `{"status", "version"}`; `GET /health/capabilities` returning `{"status", "capabilities"}`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_health_endpoints.py`:

```python
# tests/test_health_endpoints.py
from fastapi.testclient import TestClient

import backend.app.core.capabilities as cap
from backend.app.main import app


def test_health_is_200_and_ok_when_nothing_is_degraded():
    r = TestClient(app).get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert "version" in r.json()


def test_health_reports_degraded_but_still_returns_200():
    """Liveness is not capability health: a 503 here would let a load balancer
    kill a process that is serving correctly."""
    cap.failed(cap.RERANKER, "cannot score")

    r = TestClient(app).get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "degraded"


def test_health_stays_ok_for_unknown_and_disabled():
    cap.disabled(cap.RERANKER)
    cap.ok(cap.LLM)

    assert TestClient(app).get("/health").json()["status"] == "ok"


def test_capabilities_endpoint_lists_all_four_always():
    cap.failed(cap.KNOWLEDGE_STORE, "503 no healthy upstream")

    body = TestClient(app).get("/health/capabilities").json()
    assert body["status"] == "degraded"
    assert set(body["capabilities"]) == set(cap.CAPABILITIES)

    store = body["capabilities"][cap.KNOWLEDGE_STORE]
    assert store["status"] == "degraded"
    assert store["total_failed"] == 1
    assert "503" in store["last_error"]

    # An unexercised capability is present and honest about being unexercised.
    assert body["capabilities"][cap.LLM]["status"] == "unknown"


def test_capabilities_endpoint_exposes_the_dead_capability_signal():
    """total_ok 0 beside a climbing failure count is the line that identifies a
    dead capability rather than a flaky one."""
    for _ in range(20):
        cap.failed(cap.RERANKER, "cannot score")

    state = TestClient(app).get("/health/capabilities").json()["capabilities"][cap.RERANKER]
    assert state["total_ok"] == 0
    assert state["consecutive_failures"] == 20
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/Scripts/python.exe -m pytest tests/test_health_endpoints.py -q`

Expected: FAIL — `/health/capabilities` returns 404, and `/health` returns a hardcoded `ok` regardless of state.

- [ ] **Step 3: Implement the endpoints**

In `backend/app/main.py`, add to the imports:

```python
from backend.app.core import capabilities
```

Replace the health endpoint:

```python
@app.get("/health")
async def health():
    """Liveness plus one honest field.

    Deliberately always 200: a load balancer probing this must not kill a
    process because an optional capability is degraded. The body says what is
    actually working; /health/capabilities says why.
    """
    return {"status": capabilities.snapshot()["status"], "version": "3.0.0"}


@app.get("/health/capabilities")
async def health_capabilities():
    return capabilities.snapshot()
```

- [ ] **Step 4: Update the two contract tests**

In `tests/contract/test_api_contracts.py`, add the new route to `PUBLIC_ROUTES`, immediately after the `("GET", "/health")` entry:

```python
    ("GET", "/health/capabilities"),
```

Then make the health contract test order-independent. The registry is module-global, so this test must state the precondition it depends on rather than inheriting whatever earlier tests reported:

```python
def test_health_contract_is_stable():
    """Asserts the contract shape, not a particular capability state — hence
    the explicit reset. Without it this test passes or fails depending on
    collection order."""
    from backend.app.core import capabilities

    capabilities.reset()
    response = TestClient(app).get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert "version" in response.json()
```

- [ ] **Step 5: Run tests**

Run: `.venv/Scripts/python.exe -m pytest tests/test_health_endpoints.py tests/contract/test_api_contracts.py -q`

Expected: PASS, all.

Then the full suite: `.venv/Scripts/python.exe -m pytest tests -q`

Expected: 0 failures.

Then confirm the endpoints against a live process:

```bash
PYTHONPATH=. PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe -c "
from fastapi.testclient import TestClient
from backend.app.main import app
import json
c = TestClient(app)
print('health      :', c.get('/health').json())
print('capabilities:', json.dumps(c.get('/health/capabilities').json(), indent=1, default=str))
"
```

- [ ] **Step 6: Commit**

```bash
git add backend/app/main.py tests/contract/test_api_contracts.py tests/test_health_endpoints.py
git commit -m "feat(api): health endpoints report real capability state"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §3.1 state fields, four statuses, counter rationale | 1 |
| §3.2 API and `snapshot()` computing the aggregate | 1 |
| §3.3 purity, threading lock, in-memory limitation | 1 (purity is a constraint, verified by no pure module importing the registry) |
| §4 reporting sites — raising boundaries | 2 |
| §4 reporting sites — swallowing boundaries | 3 |
| §4.1 three deliberate non-reports | 2 (empty embeddings input), 3 (`_call_structured`, empty docs, `disabled`) |
| §5 boot seeding, LLM deliberately unprobed | 4 |
| §6 both endpoints, always-200 rule | 5 |
| §7 testing, behavior preservation emphasis | 2, 3 |
| §8 out of scope | no task, by design |
| §9 the limitation | documentation only |

No spec requirement is unassigned. The spec's `retrieve_candidates` / `retrieve` reporting sites are deliberately replaced by boundary reporting — recorded in File Structure above with the reason.

**Placeholder scan:** no TBD, TODO, "similar to Task N", or step lacking its code.

**Type consistency:** `capabilities.ok` / `failed` / `disabled` / `snapshot` / `reset` have the same signatures in Tasks 1–5. Capability constants `LLM`, `EMBEDDINGS`, `KNOWLEDGE_STORE`, `RERANKER` and status constants `OK`, `DEGRADED`, `DISABLED`, `UNKNOWN` are used identically throughout. `snapshot()` returns `{"status", "capabilities"}` in Task 1 and is consumed with those exact keys in Tasks 4 and 5.

**Known hazard, addressed:** the registry is module-global, which makes test outcomes order-dependent. Task 1 Step 4 adds an autouse reset fixture and Task 5 Step 4 makes the pre-existing health contract test state its own precondition.
