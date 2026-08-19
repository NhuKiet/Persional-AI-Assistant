# Hardening & UX Foundation — Design Specification

**Status:** Approved design; ready for implementation planning

## Goal

Make the assistant safe to run locally, make streamed responses reliable, and make every visible workspace control behave as users expect before introducing a cross-agent coordinator.

## Scope

This specification covers only existing Chat, Research, Coding, and PDF capabilities. It does not add new product features, authentication, remote multi-user deployment, or the orchestrator agent.

## Non-negotiable requirements

- A request must never read or write a path outside its intended artifact or sandbox root on Windows, macOS, or Linux.
- LLM-produced code must never execute on the backend host. Docker execution is mandatory; when Docker is unavailable, execution must fail with a clear user-facing error.
- A streamed event may be split arbitrarily across network chunks without losing, duplicating, or corrupting content.
- Selecting a historical chat restores its actual messages and agent state rather than only changing a sidebar highlight.
- Any page that lets a user close the sidebar must offer a keyboard-accessible way to reopen it.
- Existing API behavior must remain compatible unless this document explicitly replaces it.
- New behavior must have regression tests. Existing backend tests, frontend type checking, frontend tests, and production build must pass.

## Current risks being removed

### Coding file access and execution

The legacy coding artifact route accepts Windows backslash-rooted paths. Code block extraction also permits `../` filenames, and the executor can fall back from Docker to a host subprocess. Together these can expose local files, write outside a sandbox, or execute model-generated code in the backend process environment.

### Broken streaming and recovery

Each frontend feature currently decodes and splits each network chunk independently. SSE messages split across chunks are therefore dropped or malformed. Chat also does not consistently surface non-2xx/SSE errors.

### UI state without data state

The sidebar stores only session metadata in local storage. Selecting a previous item changes the active row but does not restore message history. Specialist pages can close the sidebar but cannot reopen it.

### Specialist reliability defects

Coding reset deletes the replacement session rather than the session it is abandoning; client abort does not propagate into the backend agent run. Research has uncaught timeout paths and inaccurate phase mapping. PDF summary copy promises the whole document while only the first 3,000 characters are summarized; deletion clears by filename instead of session; its file URL is not encoded.

## Architecture

### 1. Security boundary for Coding

Create a single path-validation boundary owned by the Coding artifact service. It accepts a **relative POSIX filename** only, rejects absolute paths, backslashes, drive prefixes, empty names, `.` and `..` components, and resolves the candidate path before checking it remains beneath the designated root. The containment comparison uses canonical paths (`Path.resolve(strict=False)` / `os.path.realpath`) for both the root and candidate, followed by `candidate.relative_to(root)`; string-prefix checks are forbidden. The run sandbox root itself must be canonicalized and rejected if it resolves outside `SANDBOX_DIR`, so a symlinked session directory cannot escape the sandbox.

The same validation function must be used for both artifact reads and files extracted from model output. The current Coding workflow generates Python only: model code-block filenames must end in exactly `.py`; all other generated filenames are rejected. Artifact reads must accept only a basename or normalized relative name that resolves beneath the validated session root and has an extension in the existing artifact allowlist: `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.html`. HTML and SVG are untrusted model output: they must be served only as downloads using `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`; the application must never inline-render them or expose them in a same-origin preview. Validation failure must be represented as a safe client error; it must never expose host path details.

The executor must have an explicit `docker` mode, and it is the only supported mode. There is no subprocess fallback. Docker unavailability, image failure, timeout, or container failure returns a typed execution result that the API converts into a clear error event/message. Every run uses `--network none`, `--read-only`, a writable `/tmp` tmpfs capped at `64m`, only the per-run sandbox bind mount, `--memory 512m`, `--cpus 1.0`, `--pids-limit 128`, and the existing `CODE_TIMEOUT=30` seconds. It additionally uses `--cap-drop ALL`, `--security-opt no-new-privileges:true`, and a non-root container UID/GID declared by `Dockerfile.executor`. The executor passes no host secrets or arbitrary host environment variables into the container.

### 2. Shared SSE transport parser

Add one frontend SSE parser utility. It retains an incomplete decoded tail between `ReadableStream` chunks, processes events only after a blank-line delimiter, supports `data:` payloads that span physical lines, and flushes the final decoder state at stream completion.

All consumers — Chat, Research, Coding, PDF summary/chat, and Deep Dive — must consume this utility rather than splitting chunks directly. Each consumer retains feature-specific event mapping, but must handle non-OK HTTP responses and error events by restoring UI controls and showing a concise actionable error.

### 3. Durable in-app session model

Backend services expose read endpoints for a session's serialized conversation/history. The response schema contains a session identifier, feature kind, monotonically increasing `revision`, and ordered message records with role, content, timestamp, and optional structured payload appropriate to the feature. The existing delete endpoint removes exactly that session. This local application explicitly supports **one backend process/worker**. Within that process, a session permits one active stream/mutation at a time; another concurrent mutation for that same feature/session receives `409 session_busy`. Reads remain allowed. All history mutations hold a per-session lock and increment `revision`, preventing two browser tabs from interleaving or silently losing turns. Deployment with more than one backend worker is out of scope until history moves to shared persistence with a cross-process lock or transactional compare-and-swap.

Frontend history metadata can stay in local storage, but selecting a session must fetch/restore messages and reconcile unavailable sessions by removing their stale local metadata. Local-storage entries created before backend history exists are treated as metadata-only legacy entries: on selection, a 404 removes the entry and shows “Phiên cũ không còn nội dung để khôi phục” without crashing or logging out the user. A single session ID source must be shared by a page and its hook; hooks must not silently generate a different active session.

### 4. App-shell navigation state

Move sidebar visibility and its reopen control to a shared app-shell-level pattern or a reusable component used by every specialist page. Closing it must not strand the user. The open/close control has an accessible name, keyboard focus indicator, and a layout that works at desktop and narrow viewport widths.

### 5. Specialist workflow corrections

Coding reset retains the old ID long enough to delete/cancel it, then creates the next ID. Backend runs accept cancellation or disconnect state and stop producing work when it is set. The UI treats planning, coding, testing, and review as busy states. Multi-file execution must either execute a declared entry file or report that execution needs an entry file; it must not silently execute index zero. Code preamble insertion must preserve valid Python placement of module docstrings and `from __future__` imports.

Research query expansion uses the selected provider or a provider-neutral fallback; no hard dependency on local Ollama. Timeout handling preserves completed results and emits a degraded status rather than crashing the stream. The backend emits a dedicated phase event and the frontend maps it faithfully. Ranking uses the current year dynamically.

PDF summary wording must accurately describe the selected scope. The default is a full-document map-reduce summary only for documents with at most **100 pages** and **100,000 extracted characters**. The processor groups extracted text into map inputs of at most **6,000 characters**, permits at most **16 map calls**, caps each intermediate summary at **800 characters**, and sends at most **12,800 characters** of intermediate summaries to one final reduce call. A document above either full-summary threshold returns a clear scope-limit message and asks the user to summarize a page range or ask a question; it must not silently summarize an excerpt. Total PDF pages comes from the reader even when no text is extractable. Deletion is scoped to the session and URLs encode the filename. Upload validation checks declared size before reading the file content.

### 6. Minimal security audit events

Use structured backend logs for the following events, without storing raw prompts, document text, host paths, or secrets: `coding.path_rejected`, `coding.artifact_access_denied`, `coding.execution_unavailable`, `coding.execution_started`, `coding.execution_finished`, `session.concurrent_mutation_rejected`, and `pdf.summary_scope_rejected`. Each event includes UTC timestamp, feature, sanitized session ID, event name, outcome, and (where applicable) a safe reason code such as `backslash_path`, `outside_root`, `docker_unavailable`, `timeout`, `page_limit`, or `char_limit`.

## Interfaces and acceptance criteria

| Area | Required interface/behavior | Acceptance criteria |
| --- | --- | --- |
| Artifact paths | `validate_relative_artifact_path(filename, root) -> Path` (name may vary) | `\\Windows\\win.ini`, `C:\\...`, `../x.py`, and `a\\b.py` are rejected; valid nested POSIX relative paths resolve inside a canonical, non-escaping root. `.html`/`.svg` artifact responses force download with `nosniff` and are never inline-rendered. |
| Generated code | Extraction validates each filename before write | Only `.py` generated filenames are accepted; no generated file can escape the run sandbox; rejection is recorded as a safe agent error. |
| Executor | Docker-only typed result | Docker absent means no host process is started and user sees an execution-unavailable message; every container has 512m RAM, 1.0 CPU, 128 PIDs, 30-second timeout, no network, read-only root, 64m `/tmp`, all Linux capabilities dropped, `no-new-privileges`, and a non-root UID/GID. |
| SSE | Shared buffered event iterator/parser | Tests with every delimiter split across chunks produce exactly the same event sequence as an unsplit stream. |
| Session history | `GET` session history plus exact session deletion | Switching sidebar entries restores corresponding messages; legacy local-only entry is removed gracefully; concurrent mutation returns `409 session_busy` with no lost turn. The process must run with exactly one backend worker. |
| Sidebar | Open and close controls on all pages | Close/reopen works by mouse and keyboard on Home, Research, Coding, PDF, and Tool routes. |
| Coding lifecycle | Cancel/reset affects original run/session | Reset deletes/cancels original ID; no duplicate concurrent agent run from the same UI. |
| Research | Degraded partial result on timeout | A timed-out source/crawl does not discard completed sources or crash SSE. |
| PDF | Truthful summary, page count, scoped deletion | Full summary uses the stated 100-page/100,000-character map-reduce limit; image-only document reports page count; filename characters do not break deletion; deleting one session preserves another session using the same file name. |
| Audit logs | Structured, privacy-safe security events | Every rejection/unavailable/timeout boundary emits its named event with a sanitized session ID and reason code. |

## Out of scope

- Login, authorization, tenant isolation, persistent database migration, or multi-worker backend coordination for externally hosted multi-user use.
- General-purpose remote sandboxing beyond the current local Docker model.
- New research providers, OCR, full-document semantic indexing, or background jobs.
- Automatic agent routing.

## Testing and quality gates

- Add backend unit/integration tests for path validation, artifact route rejection, generated-file traversal rejection, Docker-unavailable behavior, coding reset/cancellation behavior, Research timeout degradation, and PDF session deletion/page count.
- Add frontend tests for fragmented SSE, HTTP/error handling, session restoration, and sidebar reopening.
- Exercise the primary flows manually at desktop and narrow viewport widths: start/stop stream, switch history, reset Coding, run Docker-unavailable path, upload/delete PDF, and Research timeout/partial-result path.
- Run `uv run pytest -q`, `npm.cmd run typecheck`, `npm.cmd run test -- --run`, and `npm.cmd run build` before merge.

## Documentation changes

Update README setup and CI documentation to use the current `uv` workflow and remove references to deleted root API files and a missing `requirements.txt`.

## Release rule

Phase 2 (the orchestrator) may begin only after all P0/P1 security and transport/session acceptance criteria in this specification are passing in CI.
