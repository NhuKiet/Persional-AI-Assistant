import { useState, useRef, useCallback } from "react";
import { API } from "../lib/api";
import { parseSSE, readErrorResponse } from "../lib/sse";
import type { ChatMessage, ModelSelection } from "../types";

const SESSION_BUSY_NOTICE = "⚠️ Phiên đang bận (một tab/luồng khác đang gửi tin). Thử lại sau vài giây.";

/** Chat streaming (SSE) cho HomePage và các ToolPage.
 *
 * `sessionId` is owned by the calling page (not generated inside the hook) —
 * this keeps the id shown in the sidebar in sync with the id actually used
 * for backend session storage, so "restore history on select" works. */
export function useChat(tool = "chat", sessionId: string) {
  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef  = useRef<AbortController | null>(null);

  const send = useCallback(async (
    text: string,
    context = "",
    onFirstMessage: ((text: string) => void) | null = null,
    ragSessionId = "",
    model: ModelSelection | null = null,
  ) => {
    if (!text.trim() || streaming) return;
    const userMsg: ChatMessage = { role: "user",      content: text, id: Date.now() };
    const aiMsg:   ChatMessage = { role: "assistant", content: "",   id: Date.now() + 1 };
    setMessages(p => {
      if (p.length === 0 && onFirstMessage) onFirstMessage(text);
      return [...p, userMsg, aiMsg];
    });
    setStreaming(true);
    try {
      abortRef.current = new AbortController();
      const res = await fetch(`${API}/api/chat/stream`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        signal:  abortRef.current.signal,
        body: JSON.stringify({
          message: text, session_id: sessionId, tool, context, rag_session_id: ragSessionId,
          provider: model?.provider ?? null, model: model?.model ?? null,
        }),
      });
      if (res.status === 409) {
        // Another mutation is already in flight for this session — surface
        // the conflict without wiping out the existing transcript.
        setMessages(p => p.map(m => m.id === aiMsg.id ? { ...m, content: SESSION_BUSY_NOTICE } : m));
        return;
      }
      if (!res.ok) {
        const errMsg = await readErrorResponse(res);
        setMessages(p => p.map(m => m.id === aiMsg.id ? { ...m, content: "⚠️ " + errMsg } : m));
        return;
      }
      for await (const { data } of parseSSE(res.body!)) {
        try {
          const ev = JSON.parse(data);
          if (ev.type === "token") {
            setMessages(p => p.map(m => m.id === aiMsg.id ? { ...m, content: m.content + ev.content } : m));
          }
        } catch {}
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setMessages(p => p.map(m => m.id === aiMsg.id ? { ...m, content: "⚠️ Không kết nối được backend." } : m));
      }
    } finally { setStreaming(false); }
  }, [streaming, tool, sessionId]);

  const clear = useCallback(() => {
    setMessages([]);
    fetch(`${API}/api/chat/session/${sessionId}`, { method: "DELETE" }).catch(() => {});
  }, [sessionId]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return { messages, streaming, send, clear, stop, setMessages };
}
