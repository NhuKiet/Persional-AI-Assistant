# Hardening & UX Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove code-execution/file-access vulnerabilities and make stream, history, and specialist-page UX reliable before adding a chat coordinator.

**Architecture:** Put filesystem and Docker policy behind narrow backend helpers, and use one buffered SSE parser in the frontend. Session data remains in-memory and is explicitly single-worker; page hooks consume one shared session identity. Keep specialist behavior separate and repair each adapter rather than introducing a cross-agent layer.

**Tech Stack:** Python 3/FastAPI/Pydantic/PyMuPDF/Docker; React/TypeScript/Vitest; `uv`; npm.

## Global Constraints

- Support exactly one backend process/worker; multi-worker persistence is out of scope.
- Generated Coding files accept only `.py`; artifacts allow only `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.html`.
- Canonicalize with `Path.resolve(strict=False)`/`os.path.realpath`; use `candidate.relative_to(root)`, never string-prefix containment.
- Docker is the only executor: 512m RAM, 1.0 CPU, 128 PIDs, 30 seconds, network off, read-only root, `/tmp` 64m, `--cap-drop ALL`, `no-new-privileges`, non-root UID/GID.
- HTML/SVG artifacts must download with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`; never inline-preview them.
- Full PDF summary is limited to 100 pages/100,000 extracted chars; 6,000 chars/map input, 16 maps, 800 chars/map output, 12,800 chars/reduce input.
- Do not log prompts, PDF text, host paths, or secrets. Use sanitized session IDs and reason codes only.

---

## File map

| File | Responsibility |
| --- | --- |
| `backend/app/features/coding/artifacts.py` | Canonical artifact path validation and safe artifact responses. |
| `backend/app/features/coding/service.py` | Validate generated Python filenames, entry-file policy, cancellation. |
| `backend/app/features/coding/execution.py` | Docker-only executor and typed unavailable result. |
| `backend/app/core/config.py`, `Dockerfile.executor` | Docker-only defaults and non-root container image. |
| `frontend/src/lib/sse.ts` (new) | Buffered SSE parser shared by all hooks/pages. |
| `frontend/src/hooks/useChat.ts`, `useResearch.ts`, `useCoding.ts` | Shared parser, errors, unified session ID/lifecycle. |
| `frontend/src/pages/PdfPage.tsx`, `components/research/DeepDiveModal.tsx` | Shared parser and safe URL/error handling. |
| `backend/app/features/*/{router,service,schemas}.py` | Read history, session lock/revision, feature corrections. |
| `frontend/src/components/Sidebar.tsx`, pages | Restorable history and always-reopenable sidebar. |
| `tests/test_*.py`, `frontend/src/test/*.test.*` | Regression coverage. |

### Task 1: Lock down Coding paths and artifact responses

**Files:**
- Modify: `backend/app/features/coding/artifacts.py`, `backend/app/features/coding/router.py`, `backend/app/features/coding/service.py`
- Test: `tests/test_coding_service.py`, `tests/test_coding_wiring.py`, `tests/test_security.py`

**Interfaces:**
- Produce `validate_relative_path(filename: str, root: Path, allowed_suffixes: set[str]) -> Path`.
- Produce `artifact_response(path: Path) -> Response` with attachment headers for `.html`/`.svg`.

- [ ] Write failing tests for `\\Windows\\win.ini`, `C:\\Windows\\win.ini`, `../escape.py`, `a\\b.py`, a symlinked session directory, and an allowed `plots/chart.png` path. Assert forbidden inputs return 400/403 and the allowed path remains below the canonical root.
- [ ] Run: `uv run pytest tests/test_security.py tests/test_coding_service.py -q`. Expected: failures showing the legacy backslash/root behavior.
- [ ] Implement a validator that rejects empty/backslash/absolute/drive/`.`/`..` inputs, canonicalizes root and candidate, checks `candidate.relative_to(root)`, and checks suffix membership. Canonicalize `SANDBOX_DIR` and reject a session root whose resolved path is outside it.
- [ ] Route all `ArtifactService.resolve`, `resolve_root`, and generated-code writes through this validator. Change the generated-code extractor to reject any filename not ending `.py` before write. Emit `coding.path_rejected` with `{feature, session_id, reason_code}` only.
- [ ] Return `.html`/`.svg` as attachment plus `nosniff`; keep image types inline only when existing UI needs them. Add tests asserting both headers and no inline HTML response.
- [ ] Run: `uv run pytest tests/test_security.py tests/test_coding_service.py tests/test_coding_wiring.py -q`. Expected: PASS.
- [ ] Commit: `git add backend/app/features/coding tests/test_security.py tests/test_coding_service.py tests/test_coding_wiring.py && git commit -m "fix: harden coding artifact paths"`.

### Task 2: Make code execution Docker-only and privilege-minimized

**Files:**
- Modify: `backend/app/core/config.py`, `backend/app/features/coding/execution.py`, `Dockerfile.executor`
- Test: `tests/test_executor_docker.py`, `tests/test_settings.py`

**Interfaces:**
- Extend `ExecutionResult` with `unavailable: bool = False` and `reason_code: str | None = None`.
- `_docker_run_argv(...) -> list[str]` must include all global Docker constraints.

- [ ] Write failing tests that set Docker unavailable and assert `_run_subprocess` is never called, `ExecutionResult.unavailable is True`, and the Docker argv contains `--network none`, `--read-only`, `--memory 512m`, `--cpus 1.0`, `--pids-limit 128`, `--cap-drop ALL`, `--security-opt no-new-privileges:true`, and `/tmp:rw,size=64m`.
- [ ] Run: `uv run pytest tests/test_executor_docker.py tests/test_settings.py -q`. Expected: legacy fallback test failure.
- [ ] Set `EXECUTOR_MODE` default to `docker`; reject every other configured mode at settings validation. Replace fallback branches with a typed unavailable result (`exit_code=-1`, `unavailable=True`, `reason_code="docker_unavailable"`). Do not create or execute a host subprocess.
- [ ] Update `Dockerfile.executor` to create a fixed non-root user/group and use `USER` before `CMD`. Add `--user <uid>:<gid>` only if required by the image; ensure bind-mounted output remains writable by that UID/GID.
- [ ] Convert unavailable/container start/finish/timeout cases into structured `coding.execution_*` events and a safe API message.
- [ ] Run: `uv run pytest tests/test_executor_docker.py tests/test_settings.py tests/test_coding_service.py -q`. Expected: PASS. Then build once: `docker build -f Dockerfile.executor -t king-executor:latest .`.
- [ ] Commit: `git add backend/app/core/config.py backend/app/features/coding/execution.py Dockerfile.executor tests/test_executor_docker.py tests/test_settings.py && git commit -m "fix: require hardened docker executor"`.

### Task 3: Add buffered SSE parsing and migrate every consumer

**Files:**
- Create: `frontend/src/lib/sse.ts`, `frontend/src/test/sse.test.ts`
- Modify: `frontend/src/hooks/useChat.ts`, `frontend/src/hooks/useResearch.ts`, `frontend/src/hooks/useCoding.ts`, `frontend/src/pages/PdfPage.tsx`, `frontend/src/components/research/DeepDiveModal.tsx`

**Interfaces:**
- Produce `parseSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<{event: string; data: string}>`.
- Produce `readErrorResponse(response: Response): Promise<string>`.

- [ ] Write tests using one logical event split at every byte boundary, including split UTF-8 and two `data:` lines. Assert parsed event/data equals the unsplit event exactly and a trailing decoder flush is emitted.
- [ ] Run: `npm.cmd run test -- --run frontend/src/test/sse.test.ts`. Expected: FAIL because module is absent.
- [ ] Implement a `TextDecoder` with `{stream:true}`, a retained text buffer, blank-line event framing, newline-joined `data:` fields, and `decoder.decode()` flush at EOF. Ignore comments; never parse an incomplete trailing event.
- [ ] Replace all `decoder.decode(value).split("\\n")` loops with `for await` parser consumption. Before opening a reader, check `response.ok`; convert error SSE or non-OK JSON/text into a visible feature error and always clear busy state in `finally`.
- [ ] Run: `npm.cmd run test -- --run frontend/src/test/sse.test.ts`; then `npm.cmd run typecheck`. Expected: PASS.
- [ ] Commit: `git add frontend/src/lib/sse.ts frontend/src/test/sse.test.ts frontend/src/hooks frontend/src/pages/PdfPage.tsx frontend/src/components/research/DeepDiveModal.tsx && git commit -m "fix: buffer SSE events across network chunks"`.

### Task 4: Restore real history and prevent concurrent session mutations

**Files:**
- Modify: `backend/app/features/chat/{conversation_store.py,router.py,schemas.py,service.py}`, `backend/app/features/coding/{router.py,service.py,schemas.py}`, `backend/app/features/pdf/{router.py,service.py,schemas.py}`, `backend/app/features/research/{router.py,service.py,schemas.py}`
- Modify: `frontend/src/hooks/useChatHistory.ts`, `useChat.ts`, `useResearch.ts`, `useCoding.ts`, `pages/{HomePage,ResearchPage,CodingPage,PdfPage,ToolPage}.tsx`
- Test: `tests/test_chat_service.py`, `tests/test_chat_wiring.py`, `tests/test_coding_wiring.py`, `tests/test_pdf_wiring.py`, `tests/test_research_wiring.py`, `frontend/src/test/history.test.tsx`

**Interfaces:**
- Produce `GET /api/<feature>/sessions/{session_id}` returning `{session_id, feature, revision, messages}`.
- Produce a per-feature `SessionBusyError` mapped to HTTP 409 `{detail:"session_busy"}`.

- [ ] Write backend tests for history serialization/order, exact deletion, second mutation during an active stream returning 409, and revision increment. Write frontend tests selecting two sidebar entries and asserting the older message list replaces the newer list; assert a 404 legacy entry is removed with the Vietnamese recovery notice.
- [ ] Run focused pytest/Vitest commands. Expected: history endpoints and UI restoration tests fail.
- [ ] Add a keyed `threading.Lock`/active-run registry to each in-memory feature service. Acquire it only for mutation/stream lifetime; reads do not lock. Return 409 with audit event `session.concurrent_mutation_rejected`. Document single-worker limitation next to registry construction.
- [ ] Add the read endpoints and schemas. Share the page-created session ID with its hook as a parameter; remove hidden hook-generated active IDs. On sidebar select, fetch history, replace local message state, remove local-only 404 entries, and surface 409 without replacing the current transcript.
- [ ] Run: `uv run pytest tests/test_chat_service.py tests/test_chat_wiring.py tests/test_coding_wiring.py tests/test_pdf_wiring.py tests/test_research_wiring.py -q` and `npm.cmd run test -- --run frontend/src/test/history.test.tsx`. Expected: PASS.
- [ ] Commit: `git add backend/app/features frontend/src/hooks frontend/src/pages frontend/src/test/history.test.tsx tests && git commit -m "feat: restore sessions and serialize mutations"`.

### Task 5: Repair sidebar and Coding run lifecycle

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`, `frontend/src/pages/{HomePage,ResearchPage,CodingPage,PdfPage,ToolPage}.tsx`, `frontend/src/hooks/useCoding.ts`, `backend/app/features/coding/service.py`
- Test: `frontend/src/test/routes.contract.test.jsx`, `frontend/src/test/coding-lifecycle.test.tsx`, `tests/test_cancel_service.py`, `tests/test_coding_service.py`

- [ ] Write UI tests that close/reopen every route sidebar by keyboard and mouse, and Coding tests that reset deletes/cancels the original ID, not the replacement. Write backend cancellation test with a blocking generator that stops after cancellation.
- [ ] Run focused tests. Expected: failures for specialist reopen and reset target.
- [ ] Move sidebar state/control into one reusable app-shell component or pass one consistent `onOpen` control to every route. Add `aria-label`, focus-visible styling, and narrow-width coverage.
- [ ] In `useCoding.reset`, capture `const oldSessionId = sessionId.current`, abort/cancel/delete `oldSessionId`, then assign the new ID. Treat planning/coding/testing/review as busy. Add a cancel event/token to backend queue loops and stop generating when cancellation/disconnect is observed.
- [ ] Require an explicit generated entry file for multi-file execution; otherwise return a safe “choose entry file” result. Insert any execution preamble after a module docstring and `from __future__` imports.
- [ ] Run focused tests, then `npm.cmd run typecheck`. Expected: PASS.
- [ ] Commit: `git add frontend/src/components/Sidebar.tsx frontend/src/pages frontend/src/hooks/useCoding.ts backend/app/features/coding/service.py frontend/src/test tests && git commit -m "fix: restore navigation and coding lifecycle"`.

### Task 6: Correct Research and PDF limits/semantics

**Files:**
- Modify: `backend/app/features/research/{agent.py,search/query.py,search/crawl.py,search/ranking.py}`, `frontend/src/hooks/useResearch.ts`
- Modify: `backend/app/features/pdf/{processor.py,router.py,service.py,schemas.py}`, `frontend/src/pages/PdfPage.tsx`
- Test: `tests/test_research_service.py`, `tests/test_ranking_signals.py`, `tests/test_pdf_service.py`, `tests/test_pdf_wiring.py`

- [ ] Write tests for partial Research results surviving timeout, dedicated phase mapping, dynamic current year, PDF image-only page count, session-scoped delete, encoded filename, declared-size rejection before `read()`, and 101-page/100,001-character summary scope rejection.
- [ ] Run focused pytest. Expected: timeout/page-count/scope tests fail.
- [ ] Make query expansion use the selected provider or skip expansion safely; catch `TimeoutError` around both `as_completed` calls and emit a degraded status with completed sources. Emit and render a real `synthesizing` phase. Replace fixed ranking year with `datetime.now(timezone.utc).year`.
- [ ] Capture PDF page count before extracting text. Implement bounded map-reduce only within stated limits; otherwise return `pdf.summary_scope_rejected` plus a clear UI prompt. Delete conversations by session ID; `encodeURIComponent(filename)` in client URLs; enforce `UploadFile.size`/content-length before reading.
- [ ] Run: `uv run pytest tests/test_research_service.py tests/test_ranking_signals.py tests/test_pdf_service.py tests/test_pdf_wiring.py -q`. Expected: PASS.
- [ ] Commit: `git add backend/app/features/research backend/app/features/pdf frontend/src/hooks/useResearch.ts frontend/src/pages/PdfPage.tsx tests && git commit -m "fix: bound research and PDF workflows"`.

### Task 7: Prompt framing, docs, and release verification

**Files:**
- Modify: `backend/app/features/chat/prompts.py`, `README.md`, `.github/workflows/ci.yml` only if commands differ from current workflow
- Test: `tests/test_security_framing.py`, `tests/test_sse.py`

- [ ] Write a test that calls Chat prompt construction with injected context and asserts it is labeled untrusted reference material, not appended as privileged instructions. Assert the language rule is actually included.
- [ ] Run: `uv run pytest tests/test_security_framing.py tests/test_sse.py -q`. Expected: current prompt test exposes missing framing.
- [ ] Route `prompt_for` through the shared language/prompt wrapper and delimit context as untrusted quoted data. Update README to use `uv sync --dev`/`uv run pytest`, current frontend commands, and remove deleted root API files/missing `requirements.txt` references.
- [ ] Run all gates: `uv run pytest -q`; `npm.cmd run typecheck`; `npm.cmd run test -- --run`; `npm.cmd run build`.
- [ ] Manually test: artifact download headers, Docker unavailable path, fragmented stream, history switching, sidebar reopen on every specialist page, Coding reset/cancel, 101-page PDF rejection, and Research degraded timeout.
- [ ] Commit: `git add backend/app/features/chat/prompts.py README.md tests/test_security_framing.py .github/workflows/ci.yml && git commit -m "docs: align setup and harden prompt framing"`.

## Plan self-review

Every Phase 1 spec requirement maps to Tasks 1–7: path/XSS (1), Docker privilege and limits (2), SSE (3), session/concurrency (4), sidebar/Coding (5), Research/PDF (6), prompts/docs/verification (7). The plan contains concrete values, interfaces, test files, commands, and no deferred implementation markers.
