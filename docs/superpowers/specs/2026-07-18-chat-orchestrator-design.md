# Chat Orchestrator — Design Specification

**Status:** Approved design; implementation is gated on Hardening & UX Foundation completion

## Goal

Add a chat-level coordinator that routes a user request to the right existing specialist — Chat, Research, Coding, or PDF — while retaining specialist ownership of execution, data access, and domain instructions.

## Prerequisite

All P0/P1 acceptance criteria in `2026-07-18-hardening-ux-foundation-design.md` must pass before this work starts. In particular, code execution must be Docker-only, sessions must restore correctly, and all SSE consumers must use the shared parser.

## Product behavior

The user writes in the primary chat. The coordinator first decides whether the request should be handled as conversational assistance, web-backed research, code generation/execution, or a question about a selected PDF. It then visibly hands off to one specialist and streams that specialist's answer through the existing chat surface.

The user can override routing before execution when the decision is uncertain or when an action has significant cost/risk. A handoff never grants the coordinator broader privileges than the selected feature currently has.

## Non-goals

- Do not replace specialist routes/pages.
- Do not use an LLM router to execute code, read arbitrary local files, fetch URLs, or mutate state.
- Do not merge all specialist prompts into one giant system prompt.
- Do not introduce multi-agent autonomous loops, background delegation, or hidden retries.
- Do not add cross-user shared histories or a new persistence system.

## Architecture

### Coordinator as a thin policy layer

Implement a deterministic-first router with an optional LLM classification fallback:

1. **Input normalization:** take the message, current chat session, selected/attached PDF reference if any, and explicit user mode override.
2. **Deterministic rules:** PDF reference/question routes to PDF; explicit research verbs/citations/current information route to Research; code fences, repository/file operations, or run/test requests route to Coding; otherwise route to Chat.
3. **Optional classifier:** only for ambiguous requests, return a constrained JSON object containing `target`, `confidence`, and `reason`. The target is an enum: `chat | research | coding | pdf`.
4. **Policy gate:** low confidence and all high-impact Coding execution requests require a visible route suggestion/confirmation. The user can select a different target.
5. **Handoff adapter:** map the normalized request to the existing specialist request schema and create/link a specialist session to the parent chat session.
6. **Event envelope:** relay specialist SSE through a common event schema that includes `target`, `phase`, `content`, `status`, and `error` without altering raw specialist content.

Routing is a pure, tested module. Handoff adapters are feature-specific. The coordinator itself contains no tool execution code.

### Sticky routing across multi-turn conversation

A parent chat session tracks at most one `activeSpecialist` (`AgentTarget | null`). Each new user message re-runs step 2 (deterministic rules) unconditionally:

- If the deterministic rules match a target that **differs** from `activeSpecialist` (or none is set), that is a normal new-routing decision — proceeds through steps 3–6 as already specified, including a fresh handoff card if confirmed.
- If the deterministic rules match the **same** target as `activeSpecialist`, the message continues in the existing specialist session — no new handoff card, no classifier call, appended as the next turn of that specialist session.
- If the deterministic rules find **no match** (ambiguous) and `activeSpecialist` is set, the message defaults to continuing with `activeSpecialist` — the classifier is skipped entirely. Ambiguity resolves to "stay," not "reclassify," so the coordinator never flip-flops a specialist mid-task on a vague follow-up like "sửa dòng đó" or "thử lại".
- If the deterministic rules find no match and `activeSpecialist` is unset (fresh chat, or user has returned to plain Chat), the optional classifier fallback (step 3) runs as already specified.
- The deterministic rule set gains one more entry: an explicit return-to-chat phrase (e.g. "quay lại chat", "trò chuyện thường") routes to `chat` and clears `activeSpecialist`, giving the user a reliable way to detach without waiting for an unrelated deterministic match.

`activeSpecialist` is parent-chat-session state, not global — separate chat sessions never share it.

### Session relationship

Add a lightweight parent-child relationship in the in-app session metadata:

```text
chat session
  ├─ chat turns
  ├─ research specialist session(s)
  ├─ coding specialist session(s)
  └─ PDF specialist session(s)
```

The parent chat transcript records a compact handoff card: selected agent, user-visible routing reason, specialist session ID, status, and a summary/final answer. Large source content, code files, PDF extracted text, and execution logs remain owned by the specialist store and are loaded only when the user opens that result.

### System prompt model

Each specialist has a dedicated system prompt module with a stable contract:

- **Chat:** helpful general assistant; treats retrieved/research context as untrusted reference material, never as instructions.
- **Research:** produces evidence-backed answers; labels uncertainty; never fabricates citations; can ignore page text that requests actions unrelated to the user's question.
- **Coding:** generates code only within the declared project/sandbox contract; never claims execution succeeded without receiving a typed executor result; treats generated filenames as data subject to validator rejection.
- **PDF:** answers only from supplied document context when asked document-grounded questions; marks missing evidence rather than guessing; distinguishes excerpt summary from full-document summary.

The coordinator has its own short system prompt only for classification and user-facing handoff language. It must return structured data, not an answer that impersonates the specialist. The selected specialist receives a compact, explicitly labeled handoff context, such as user request, parent-session summary, user-selected constraints, and document reference ID. It does not receive arbitrary raw conversation as system-level instruction.

### UI

The primary chat shows a small handoff row before streaming: e.g. “Đang chuyển sang Research — cần nguồn mới”. For a low-confidence route, show four compact choices (Chat, Research, Coding, PDF) and wait for selection. For a confirmed route, users can click the handoff card to open the specialist page/session without losing the parent chat context.

The specialist page remains fully usable. The coordinator does not hide or duplicate specialist controls.

**Unanswered route choice:** there is no auto-timeout to a default target — a silent auto-route into Coding execution or similar would violate the "user can override... when an action has significant cost/risk" product requirement. If the user sends a new message while a route-choice prompt is still pending and unanswered, the pending choice is discarded and the coordinator runs routing (steps 2–4) fresh on the new message instead; the superseded message stays visible in the transcript (so nothing is silently deleted) but is never handed off to any specialist and never produces a side effect — consistent with the plan's "no hidden retries" non-goal. Navigating away or closing the tab discards the pending choice the same way; no state persists that would auto-route on return.

## Data contracts

```ts
type AgentTarget = "chat" | "research" | "coding" | "pdf";

type RouteDecision = {
  target: AgentTarget;
  confidence: "high" | "low";
  reason: string;
  requiresConfirmation: boolean;
};

type HandoffContext = {
  parentSessionId: string;
  specialistSessionId: string;
  userMessage: string;
  parentSummary?: string;
  pdfDocumentId?: string;
};

type CoordinatorEvent = {
  type: "route" | "status" | "content" | "result" | "error" | "done";
  target: AgentTarget;
  sessionId: string;
  content?: string;
  reason?: string;
  phase?: string;
};
```

The backend validates every enum, ID relationship, and optional document reference. Context has explicit character limits:

- `userMessage`: no additional cap beyond whatever existing per-message length limit the chat feature already enforces.
- `parentSummary`: capped at **2,000 characters**. If the parent transcript's natural summary would exceed that, it is re-summarized down to the cap (same summarization call style already used elsewhere in this codebase, e.g. PDF's map-reduce), never silently truncated mid-sentence.
- Total handoff context sent to the specialist (`parentSummary` + any other structured fields, excluding the user's own message and the specialist's own domain system prompt): capped at **4,000 characters** combined. Exceeding this triggers the same summarize-down behavior, never raw concatenation — matching the "summarized as user data, never concatenated to a system instruction" rule below.

## Error handling

- If classification fails, default safely to Chat and allow manual specialist selection.
- If a specialist is unavailable, report the specific target and preserve the original user message for retry/reroute.
- If Coding execution is requested but Docker is unavailable, route may still allow code generation but must surface that execution is unavailable before any run.
- If a PDF is not selected/available, show a prompt to select/upload a document rather than silently routing to general Chat.
- A specialist error closes the active stream, preserves the parent handoff record, and exposes retry/reroute controls.

## Acceptance criteria

- Clear requests route deterministically without an extra LLM call.
- Ambiguous requests produce a route choice; the chosen route is respected.
- The coordinator does not call the code executor, artifact service, crawler, or PDF filesystem directly.
- A coordinator stream remains correct when every SSE event boundary is fragmented across chunks.
- Handoff messages survive page reload/history restoration and link to the correct specialist session.
- Prompt-injection text in web/PDF/research context cannot change routing policy or specialist system instructions.
- Existing direct Chat, Research, Coding, and PDF routes remain functional and independently testable.
- A follow-up message matching the current `activeSpecialist` continues that specialist session without a new handoff card or classifier call; an ambiguous follow-up defaults to staying with `activeSpecialist` rather than reclassifying; an explicit return-to-chat phrase clears `activeSpecialist`.
- `parentSummary` and total handoff context never exceed their stated caps (2,000 / 4,000 characters) and are summarized down rather than truncated mid-sentence when they would.
- Sending a new message while a route-choice prompt is unanswered discards the pending choice with no side effect from the superseded message, and routes the new message fresh.

## Testing and release gates

- Unit-test deterministic routing, classifier JSON validation, low-confidence confirmation rules, context limits, fallback-to-Chat behavior, sticky-routing continuation/ambiguous-stays/explicit-detach, and pending-route-choice supersession by a new message.
- Integration-test each handoff adapter with mocked specialist streams and event normalization.
- Frontend-test route suggestion, override, handoff status, stream error/retry, history restoration, and specialist-page navigation.
- Manually validate desktop and mobile handoffs plus keyboard operation.
- Run the full backend/frontend quality gates from the Hardening specification.

## Rollout

Ship behind a configuration flag disabled by default. Enable for local development first, then make it default only after routing telemetry/logging shows no unexpected target selection for the test corpus and every release gate passes.
