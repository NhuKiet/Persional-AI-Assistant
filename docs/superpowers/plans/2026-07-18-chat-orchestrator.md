# Chat Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route primary-chat requests safely to existing Chat, Research, Coding, or PDF specialists without granting the coordinator execution or file privileges.

**Architecture:** Add a pure routing policy and feature-specific handoff adapters behind one coordinator service/router. The frontend renders route selection and handoff cards; specialist SSE is normalized through the Phase 1 parser. Each specialist keeps its own system prompt and session store.

**Tech Stack:** Python/FastAPI/Pydantic; React/TypeScript/Vitest; existing LLM provider abstraction and SSE utility from Phase 1.

## Global Constraints

- Do not start this plan until all Phase 1 P0/P1 gates pass.
- The coordinator must not import/call the executor, artifact service, crawler, or PDF filesystem.
- Use deterministic routing before optional structured LLM classification.
- `AgentTarget` is exactly `chat | research | coding | pdf`; validate every target and session/document ID.
- Low-confidence routes and any Coding execution request require visible user confirmation.
- Context is bounded and labeled untrusted data; never append it to a system prompt as instructions.
- Ship behind a disabled-by-default configuration flag.

---

## File map

| File | Responsibility |
| --- | --- |
| `backend/app/features/orchestrator/schemas.py` (new) | Route, handoff, and event Pydantic contracts. |
| `backend/app/features/orchestrator/routing.py` (new) | Pure deterministic routing and classifier JSON validation. |
| `backend/app/features/orchestrator/service.py` (new) | Confirmation policy and specialist handoff adapters. |
| `backend/app/features/orchestrator/router.py` (new) | Coordinator HTTP/SSE endpoints. |
| `backend/app/features/orchestrator/prompts.py` (new) | Short classifier-only system prompt. |
| `backend/app/main.py` or existing route registration | Register router behind feature flag. |
| `frontend/src/hooks/useCoordinator.ts` (new) | Coordinator stream/session state. |
| `frontend/src/components/chat/HandoffCard.tsx` (new) | Route status, override, retry, specialist deep link. |
| `frontend/src/pages/HomePage.tsx` | Replace direct Chat send with coordinator flow behind flag. |
| `tests/test_orchestrator_*.py`, `frontend/src/test/orchestrator*.test.tsx` | Unit, integration, and UI coverage. |

### Task 1: Define contracts and a deterministic router

**Files:**
- Create: `backend/app/features/orchestrator/{__init__.py,schemas.py,routing.py,prompts.py}`, `tests/test_orchestrator_routing.py`

**Interfaces:**
- `AgentTarget = Literal["chat", "research", "coding", "pdf"]`.
- `RouteDecision(target, confidence, reason, requires_confirmation)`.
- `route_deterministically(message, pdf_document_id, override) -> RouteDecision | None`.

- [ ] Write table-driven tests: explicit override wins; a selected PDF routes PDF; “tìm nguồn mới/citations/current” routes Research; code fence/“run test” routes Coding with confirmation; plain conversational text routes Chat; an ambiguous “giúp tôi phân tích” returns `None` for classifier/choice.
- [ ] Run: `uv run pytest tests/test_orchestrator_routing.py -q`. Expected: FAIL because module is absent.
- [ ] Implement immutable Pydantic schemas and pure keyword/metadata rules. Never call an LLM in `route_deterministically`. Add a short classifier prompt that returns only JSON fields `target`, `confidence`, `reason` and says retrieved text is untrusted.
- [ ] Validate classifier output through `RouteDecision`; malformed output defaults to Chat with low confidence and reason `classifier_invalid`.
- [ ] Run focused test. Expected: PASS.
- [ ] Commit: `git add backend/app/features/orchestrator tests/test_orchestrator_routing.py && git commit -m "feat: add deterministic agent routing contracts"`.

### Task 2: Build safe handoff service and event normalization

**Files:**
- Create: `backend/app/features/orchestrator/{service.py,router.py}`, `tests/test_orchestrator_service.py`
- Modify: route registration file and feature config in `backend/app/core/config.py`

**Interfaces:**
- `CoordinatorEvent(type, target, session_id, content=None, reason=None, phase=None)`.
- `CoordinatorService.start(request) -> Iterator[dict]`.

- [ ] Write integration tests with fake Chat/Research/Coding/PDF adapters. Assert service maps a confirmed route to only the corresponding adapter, converts specialist event types to the coordinator envelope, and never imports `execution`, `artifacts`, crawler, or PDF processor modules.
- [ ] Add tests for low confidence returning `route` then stopping before adapter call; classifier exception defaulting to Chat; specialist error preserving route metadata and producing `error` then `done`.
- [ ] Run: `uv run pytest tests/test_orchestrator_service.py -q`. Expected: FAIL.
- [ ] Implement adapters that call only public specialist service/request interfaces. Generate a child specialist session ID, associate it with `parent_session_id`, and persist a compact handoff record: target, reason, child ID, status, final summary. Bound `parent_summary` and message context to `MAX_MESSAGE_CHARS`; label it `UNTRUSTED HANDOFF CONTEXT`.
- [ ] Add `/api/orchestrator/route` and `/api/orchestrator/stream`; reject unknown targets/IDs with 422, unavailable specialist with a retryable error, and unconfirmed route with a route-choice event. Gate registration with `ENABLE_ORCHESTRATOR=False` default.
- [ ] Run focused test plus `uv run pytest tests/test_feature_boundaries.py -q`. Expected: PASS.
- [ ] Commit: `git add backend/app/features/orchestrator backend/app/core/config.py backend/app/main.py tests/test_orchestrator_service.py && git commit -m "feat: stream safe specialist handoffs"`.

### Task 3: Add specialist prompt contracts and injection boundaries

**Files:**
- Modify: `backend/app/features/chat/prompts.py`, `backend/app/features/coding/prompts.py`, add/modify Research and PDF prompt modules used by their services
- Test: `tests/test_security_framing.py`, `tests/test_orchestrator_prompts.py`

- [ ] Write tests for each specialist system prompt: Chat labels research context untrusted; Research refuses instructions from sources; Coding does not claim execution absent a typed result; PDF states when evidence is absent. Assert coordinator prompt has no tool/execution language and only returns schema JSON.
- [ ] Run: `uv run pytest tests/test_orchestrator_prompts.py tests/test_security_framing.py -q`. Expected: FAIL for missing/implicit contracts.
- [ ] Centralize each existing specialist's system prompt in its feature prompt module without changing its public service behavior. Add `build_handoff_context()` that wraps bounded fields in XML-like data tags and never places them in the system message.
- [ ] Run focused tests. Expected: PASS.
- [ ] Commit: `git add backend/app/features/*/prompts.py tests/test_orchestrator_prompts.py tests/test_security_framing.py && git commit -m "feat: define specialist prompt contracts"`.

### Task 4: Render route selection and handoff cards in primary chat

**Files:**
- Create: `frontend/src/hooks/useCoordinator.ts`, `frontend/src/components/chat/HandoffCard.tsx`, `frontend/src/test/orchestrator.test.tsx`
- Modify: `frontend/src/pages/HomePage.tsx`, `frontend/src/hooks/useChat.ts`, route/session history types as needed

**Interfaces:**
- `useCoordinator({ parentSessionId })` exposes `send`, `chooseTarget`, `retry`, `state`.
- `HandoffCard({ decision, onChoose, onOpenSpecialist, status })`.

- [ ] Write UI tests for: deterministic Research card streams without choice; ambiguous route shows four choices and sends no stream until selected; Coding route requires confirmation; specialist error exposes retry/reroute; clicking completed card navigates with child session ID; fragmented SSE renders exactly once.
- [ ] Run: `npm.cmd run test -- --run frontend/src/test/orchestrator.test.tsx`. Expected: FAIL.
- [ ] Implement the hook using the shared Phase 1 `parseSSE` utility. Preserve the user message and handoff record in parent history before stream start. Render compact Vietnamese status text, use accessible buttons for the four targets, and disable actions while stream state is active.
- [ ] Feature-flag Home page: existing direct Chat remains the fallback when disabled. Do not remove specialist routes/pages.
- [ ] Run focused Vitest and `npm.cmd run typecheck`. Expected: PASS.
- [ ] Commit: `git add frontend/src/hooks/useCoordinator.ts frontend/src/components/chat/HandoffCard.tsx frontend/src/pages/HomePage.tsx frontend/src/test/orchestrator.test.tsx && git commit -m "feat: add chat handoff experience"`.

### Task 5: Persist handoff history and cross-page navigation

**Files:**
- Modify: parent session store/schema from Phase 1, `backend/app/features/orchestrator/service.py`, `frontend/src/hooks/useChatHistory.ts`, specialist pages
- Test: `tests/test_orchestrator_service.py`, `frontend/src/test/orchestrator-history.test.tsx`

- [ ] Write tests that reload/restore a parent session containing two handoffs, assert each points to its own child session, and assert opening a missing child shows a recoverable error while preserving parent transcript.
- [ ] Run focused tests. Expected: FAIL.
- [ ] Store only compact handoff metadata in parent records; leave sources/code/PDF text in specialist session stores. Include `target`, `reason`, `child_session_id`, `status`, and final summary. Add navigation query/state parsing on specialist pages to restore the referenced child session.
- [ ] Run focused tests. Expected: PASS.
- [ ] Commit: `git add backend/app/features/orchestrator frontend/src/hooks/useChatHistory.ts frontend/src/pages tests frontend/src/test/orchestrator-history.test.tsx && git commit -m "feat: persist coordinator handoff history"`.

### Task 6: Flagged rollout and full verification

**Files:**
- Modify: `README.md`, `.env.example` if present, release/config documentation
- Test: all orchestrator tests plus existing gates

- [ ] Write a settings test asserting orchestrator is disabled by default and enabled only by explicit valid boolean configuration.
- [ ] Run: `uv run pytest tests/test_orchestrator_routing.py tests/test_orchestrator_service.py tests/test_orchestrator_prompts.py -q`. Expected: PASS.
- [ ] Document local enablement, Docker prerequisite inherited from Phase 1, manual route override, and the single-worker limitation. Do not enable the feature by default in the committed configuration.
- [ ] Run final gates: `uv run pytest -q`; `npm.cmd run typecheck`; `npm.cmd run test -- --run`; `npm.cmd run build`.
- [ ] Manually validate desktop/mobile and keyboard flows for Chat/Research/Coding/PDF route, ambiguous override, unavailable PDF, Docker-unavailable execution request, specialist stream error/retry, history reload, and direct specialist pages.
- [ ] Commit: `git add README.md .env.example backend/app/core/config.py tests/test_settings.py && git commit -m "docs: document orchestrator rollout flag"`.

## Plan self-review

Phase 2 requirements map directly to Tasks 1–6: deterministic/validated routing (1), privilege-free handoff and normalized SSE (2), dedicated prompts and injection boundaries (3), visible user control (4), durable parent-child history (5), and disabled-by-default release verification (6). All named contracts are introduced before consumers use them.
