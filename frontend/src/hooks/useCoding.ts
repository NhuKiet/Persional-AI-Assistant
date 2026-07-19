import { useState, useRef, useCallback, useEffect } from "react";
import { API } from "../lib/api";
import { parseSSE, readErrorResponse } from "../lib/sse";
import type { ChatMessage } from "../types";

const SESSION_BUSY_NOTICE = "⚠️ Phiên đang bận (một tab/luồng khác đang gửi tin). Thử lại sau vài giây.";

export type CodingPhase =
  | "idle" | "thinking" | "planning" | "generating" | "executing"
  | "debugging" | "testing" | "reviewing" | "done" | "error";

/** Every phase during which the agent is actively working server-side —
 *  the input must stay disabled through all of them, not just the earlier
 *  ones. Exported so pages don't have to keep their own (previously
 *  incomplete) copy of this list in sync by hand. */
export const BUSY_PHASES: CodingPhase[] = [
  "thinking", "planning", "generating", "executing", "debugging", "testing", "reviewing",
];

export const isBusyPhase = (phase: CodingPhase): boolean => BUSY_PHASES.includes(phase);

export interface PlanStep {
  step: number;
  title: string;
  description: string;
}

/** Raw SSE payload from the coding agent — shape owned by the Python backend,
 *  kept loose here rather than guessed at field-by-field. */
export interface CodingEvent {
  type: string;
  ts?: number;
  [key: string]: unknown;
}

export interface InstallingState {
  packages: unknown;
  message: string;
}

/** Thiết lập cho coding agent.
 *
 * `sessionId` is owned by the calling page (not generated inside the hook) —
 * this keeps the id shown in the sidebar in sync with the id actually used
 * for backend session storage, so "restore history on select" works. */
export function useCoding(sessionId: string) {
  const [phase,     setPhase]     = useState<CodingPhase>("idle");
  const [events,    setEvents]    = useState<CodingEvent[]>([]);
  const [plan,      setPlan]      = useState<PlanStep[] | null>(null);
  const [codes,     setCodes]     = useState<CodingEvent[]>([]);
  const [output,    setOutput]    = useState<CodingEvent | null>(null);
  const [artifacts, setArtifacts] = useState<string[]>([]);
  const [finalMsg,  setFinalMsg]  = useState("");
  const [success,   setSuccess]   = useState<boolean | null>(null);
  const [heartbeat, setHeartbeat] = useState("");
  const [chatMsgs,  setChatMsgs]  = useState<ChatMessage[]>([]);
  const [planStream, setPlanStream] = useState("");
  const [codeStream, setCodeStream] = useState("");
  const [installing, setInstalling] = useState<InstallingState | null>(null);
  const [testOutput, setTestOutput] = useState<CodingEvent | null>(null);
  const [review,     setReview]     = useState<string | null>(null);
  const abortRef  = useRef<AbortController | null>(null);

  const pushEvent = (ev: CodingEvent) => setEvents(p => [...p, { ...ev, ts: Date.now() }]);

  const run = useCallback(async (
    message: string,
    chatOnly = false,
    uploadedFiles: unknown[] = [],
    model: { provider?: string; model?: string } | null = null,
  ) => {
    if (!message.trim()) return;
    setPhase("thinking");
    setPlan(null); setCodes([]); setOutput(null); setArtifacts([]); setFinalMsg(""); setSuccess(null); setHeartbeat(""); setPlanStream(""); setCodeStream(""); setInstalling(null); setTestOutput(null); setReview(null);
    const nowId   = Date.now();
    const aiMsgId = nowId + 1;

    if (chatOnly) {
      const userMsg: ChatMessage = { role: "user",      content: message, id: nowId };
      const aiMsg:   ChatMessage = { role: "assistant", content: "",      id: aiMsgId };
      setChatMsgs(p => [...p, userMsg, aiMsg]);
    } else {
      pushEvent({ type: "thinking", message: "Đang khởi động agent..." });
    }

    try {
      abortRef.current = new AbortController();
      const res = await fetch(`${API}/api/coding/stream`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        signal:  abortRef.current.signal,
        body: JSON.stringify({
          message, session_id: sessionId, chat_only: chatOnly, uploaded_files: uploadedFiles,
          provider: model?.provider ?? null, model: model?.model ?? null,
        }),
      });
      if (res.status === 409) {
        // Another mutation is already in flight for this session — surface
        // the conflict without wiping out the existing transcript.
        setPhase("error"); setFinalMsg(SESSION_BUSY_NOTICE);
        if (chatOnly) setChatMsgs(p => p.map(m => m.id === aiMsgId ? { ...m, content: SESSION_BUSY_NOTICE } : m));
        return;
      }
      if (!res.ok) { setPhase("error"); setFinalMsg(await readErrorResponse(res)); return; }

      for await (const { data } of parseSSE(res.body!)) {
        try {
          const ev: CodingEvent = JSON.parse(data);
          switch (ev.type) {
            case "thinking":
              setPhase("thinking"); break;
            case "plan_thinking":
              setPhase("planning"); setPlanStream(p => p + (ev.content as string)); break;
            case "plan":
              setPhase("planning"); setPlan(ev.steps as PlanStep[]); setHeartbeat(""); pushEvent(ev); break;
            case "generating":
              setPhase("generating"); setCodeStream(""); break;
            case "code_token":
              setCodeStream(p => p + (ev.content as string)); break;
            case "code":
              setCodes(p => [...p, ev]); setHeartbeat(""); setCodeStream(""); pushEvent(ev); break;
            case "executing":
              setPhase("executing"); break;
            case "output": {
              setOutput(ev); setHeartbeat("");
              const evArtifacts = ev.artifacts as string[] | undefined;
              if (evArtifacts?.length) setArtifacts(p => [...new Set([...p, ...evArtifacts])]);
              pushEvent(ev); break;
            }
            case "debugging":
              setPhase("debugging"); pushEvent(ev); break;
            case "installing":
              setInstalling({ packages: ev.packages, message: ev.message as string }); break;
            case "install_done":
              setInstalling(null); break;
            case "testing":
              setPhase("testing"); break;
            case "test_output":
              setTestOutput(ev); break;
            case "reviewing":
              setPhase("reviewing"); break;
            case "review":
              setReview(ev.content as string); break;
            case "done": {
              setPhase("done"); setFinalMsg(ev.message as string); setSuccess(ev.success as boolean);
              const doneArtifacts = ev.artifacts as string[] | undefined;
              if (doneArtifacts?.length) setArtifacts(p => [...new Set([...p, ...doneArtifacts])]);
              pushEvent(ev); break;
            }
            case "heartbeat":
              setHeartbeat(ev.message as string); break;
            case "error":
              setPhase("error"); setFinalMsg(ev.message as string); setHeartbeat(""); pushEvent(ev); break;
            case "token":
              setChatMsgs(p => p.map(m => m.id === aiMsgId ? { ...m, content: m.content + (ev.content as string) } : m));
              break;
          }
        } catch {}
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") { setPhase("error"); setFinalMsg("Mất kết nối backend."); }
    }
  }, [sessionId]);

  // Rời trang bằng đường nào cũng hủy agent đang chạy (không xóa session ở đây
  // — reset() mới xóa; unmount chỉ cần dừng stream để khỏi rò rỉ).
  useEffect(() => () => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    // Capture the id being abandoned BEFORE anything else runs. `reset` is
    // recreated every render bound to that render's `sessionId` prop, so
    // this always names the session the caller is walking away from — never
    // whatever id the page assigns next (that happens after this call
    // returns; session id generation/rotation is owned by the page, see the
    // hook doc-comment above).
    const oldSessionId = sessionId;
    abortRef.current?.abort();
    setPhase("idle"); setEvents([]); setPlan(null); setCodes([]);
    setOutput(null); setFinalMsg(""); setSuccess(null);
    // Delete + cancel the abandoned session server-side. The DELETE clears
    // its persisted chat history; the fetch abort above closes the SSE
    // connection, which the backend's `finally` block turns into a
    // cancel-event so the abandoned agent run actually stops (not just the
    // client-side stream) instead of continuing to burn LLM/executor work
    // for a session nobody is looking at anymore.
    fetch(`${API}/api/coding/session/${oldSessionId}`, { method: "DELETE" }).catch(() => {});
  }, [sessionId]);

  const clearChat = useCallback(() => setChatMsgs([]), []);

  return { phase, events, plan, codes, output, artifacts, finalMsg, success, heartbeat, chatMsgs, planStream, codeStream, installing, testOutput, review, run, reset, clearChat, setChatMsgs };
}
