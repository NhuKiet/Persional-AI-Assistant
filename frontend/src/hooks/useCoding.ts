import { useState, useRef, useCallback, useEffect } from "react";
import { API, SESSION_ID } from "../lib/api";
import type { ChatMessage } from "../types";

export type CodingPhase =
  | "idle" | "thinking" | "planning" | "generating" | "executing"
  | "debugging" | "testing" | "reviewing" | "done" | "error";

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

/** Thiết lập cho coding agent */
export function useCoding() {
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
  const sessionId = useRef(SESSION_ID());
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
          message, session_id: sessionId.current, chat_only: chatOnly, uploaded_files: uploadedFiles,
          provider: model?.provider ?? null, model: model?.model ?? null,
        }),
      });
      if (!res.ok) { setPhase("error"); setFinalMsg(`Backend lỗi ${res.status}`); return; }

      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        for (const line of decoder.decode(value, { stream: true }).split("\n")) {
          if (!line.startsWith("data:")) continue;
          try {
            const ev: CodingEvent = JSON.parse(line.slice(5).trim());
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
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") { setPhase("error"); setFinalMsg("Mất kết nối backend."); }
    }
  }, []);

  // Rời trang bằng đường nào cũng hủy agent đang chạy (không xóa session ở đây
  // — reset() mới xóa; unmount chỉ cần dừng stream để khỏi rò rỉ).
  useEffect(() => () => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setPhase("idle"); setEvents([]); setPlan(null); setCodes([]);
    setOutput(null); setFinalMsg(""); setSuccess(null);
    sessionId.current = SESSION_ID();
    fetch(`${API}/api/coding/session/${sessionId.current}`, { method: "DELETE" }).catch(() => {});
  }, []);

  const clearChat = useCallback(() => setChatMsgs([]), []);

  return { phase, events, plan, codes, output, artifacts, finalMsg, success, heartbeat, chatMsgs, planStream, codeStream, installing, testOutput, review, sessionId: sessionId.current, run, reset, clearChat };
}
