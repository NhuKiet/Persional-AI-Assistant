import { useState, useRef, useCallback } from "react";
import { API, SESSION_ID } from "../lib/api";
import { getPersistedSessionId, persistSessionId } from "../lib/storage";
import type { ChatMessage, ModelSelection } from "../types";

/** Chat streaming (SSE) cho HomePage và các ToolPage. */
export function useChat(tool = "chat") {
  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const sessionId = useRef(getPersistedSessionId(tool) || SESSION_ID());
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
          message: text, session_id: sessionId.current, tool, context, rag_session_id: ragSessionId,
          provider: model?.provider ?? null, model: model?.model ?? null,
        }),
      });
      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value).split("\n")) {
          if (!line.startsWith("data:")) continue;
          try {
            const ev = JSON.parse(line.slice(5));
            if (ev.type === "token") {
              setMessages(p => p.map(m => m.id === aiMsg.id ? { ...m, content: m.content + ev.content } : m));
            }
          } catch {}
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setMessages(p => p.map(m => m.id === aiMsg.id ? { ...m, content: "⚠️ Không kết nối được backend." } : m));
      }
    } finally { setStreaming(false); }
  }, [streaming, tool]);

  const clear = useCallback(() => {
    const oldId = sessionId.current;
    sessionId.current = SESSION_ID();
    persistSessionId(tool, sessionId.current);
    setMessages([]);
    fetch(`${API}/api/chat/session/${oldId}`, { method: "DELETE" }).catch(() => {});
  }, [tool]);
  const stop = useCallback(() => abortRef.current?.abort(), []);
  return { messages, streaming, send, clear, stop };
}
