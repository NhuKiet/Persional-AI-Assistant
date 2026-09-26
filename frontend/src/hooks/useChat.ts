import { useState, useRef, useCallback } from "react";
import { API, apiFetch } from "../lib/api";
import { parseSSE, readErrorResponse } from "../lib/sse";
import type { ChatMessage, ModelSelection } from "../types";

const SESSION_BUSY_NOTICE = "⚠️ Phiên đang bận (một tab/luồng khác đang gửi tin). Thử lại sau vài giây.";
const STREAM_ERROR_NOTICE = "Có lỗi khi tạo câu trả lời. Thử lại sau.";
const EMPTY_REPLY_NOTICE  = "⚠️ Không nhận được phản hồi từ backend. Thử lại sau.";

interface ReplyRequest {
  text: string;
  context: string;
  ragSessionId: string;
  model: ModelSelection | null;
  /** Backend drops the session's last exchange and answers `text` instead. */
  replaceLast: boolean;
}

function lastUserIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") return i;
  return -1;
}

/** Chat streaming (SSE) cho HomePage và các ToolPage.
 *
 * `sessionId` is owned by the calling page (not generated inside the hook) —
 * this keeps the id shown in the sidebar in sync with the id actually used
 * for backend session storage, so "restore history on select" works. */
export function useChat(tool = "chat", sessionId: string) {
  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef  = useRef<AbortController | null>(null);
  // Read by regenerate/editLast, which run from click handlers and need the
  // transcript and the context the question was first asked with.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const lastContext = useRef({ context: "", ragSessionId: "" });
  // Message ids: time-based but strictly increasing. Plain Date.now() gave
  // two turns sent within the same millisecond the same assistant id, and
  // the second reply streamed into both bubbles.
  const lastId = useRef(0);
  const nextId = () => (lastId.current = Math.max(Date.now(), lastId.current + 1));

  /** Stream one reply into the assistant bubble `aiId`. */
  const streamReply = useCallback(async (req: ReplyRequest, aiId: number) => {
    const update = (fn: (content: string) => string) =>
      setMessages(p => p.map(m => m.id === aiId ? { ...m, content: fn(m.content) } : m));
    setStreaming(true);
    try {
      abortRef.current = new AbortController();
      const res = await apiFetch(`${API}/api/chat/stream`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        signal:  abortRef.current.signal,
        body: JSON.stringify({
          message: req.text, session_id: sessionId, tool, context: req.context, rag_session_id: req.ragSessionId,
          provider: req.model?.provider ?? null, model: req.model?.model ?? null,
          replace_last: req.replaceLast,
        }),
      });
      if (res.status === 409) {
        // Another mutation is already in flight for this session — surface
        // the conflict without wiping out the existing transcript.
        update(() => SESSION_BUSY_NOTICE);
        return;
      }
      if (!res.ok) {
        const errMsg = await readErrorResponse(res);
        update(() => "⚠️ " + errMsg);
        return;
      }
      let received = false;
      for await (const { data } of parseSSE(res.body!)) {
        try {
          const ev = JSON.parse(data);
          if (ev.type === "token") {
            received = true;
            update(content => content + ev.content);
          } else if (ev.type === "error") {
            received = true;
            // Keep any partial answer; the notice goes below it.
            const notice = "⚠️ " + (ev.message || STREAM_ERROR_NOTICE);
            update(content => content ? `${content}\n\n${notice}` : notice);
          }
        } catch {}
      }
      if (!received) update(() => EMPTY_REPLY_NOTICE);
    } catch (e) {
      if ((e as Error).name !== "AbortError") update(() => "⚠️ Không kết nối được backend.");
    } finally { setStreaming(false); }
  }, [tool, sessionId]);

  const send = useCallback(async (
    text: string,
    context = "",
    onFirstMessage: ((text: string) => void) | null = null,
    ragSessionId = "",
    model: ModelSelection | null = null,
  ) => {
    if (!text.trim() || streaming) return;
    lastContext.current = { context, ragSessionId };
    const userMsg: ChatMessage = { role: "user",      content: text, id: nextId() };
    const aiMsg:   ChatMessage = { role: "assistant", content: "",   id: nextId() };
    setMessages(p => {
      if (p.length === 0 && onFirstMessage) onFirstMessage(text);
      return [...p, userMsg, aiMsg];
    });
    await streamReply({ text, context, ragSessionId, model, replaceLast: false }, aiMsg.id);
  }, [streaming, streamReply]);

  /** Answer the last question again, replacing the answer after it. */
  const regenerate = useCallback(async (model: ModelSelection | null = null) => {
    if (streaming) return;
    const at = lastUserIndex(messagesRef.current);
    if (at === -1) return;
    const question = messagesRef.current[at].content;
    const aiMsg: ChatMessage = { role: "assistant", content: "", id: nextId() };
    setMessages(p => [...p.slice(0, at + 1), aiMsg]);
    await streamReply({ text: question, ...lastContext.current, model, replaceLast: true }, aiMsg.id);
  }, [streaming, streamReply]);

  /** Replace the last question with `text` and answer it. */
  const editLast = useCallback(async (text: string, model: ModelSelection | null = null) => {
    if (!text.trim() || streaming) return;
    const at = lastUserIndex(messagesRef.current);
    if (at === -1) return;
    const userMsg: ChatMessage = { role: "user",      content: text, id: nextId() };
    const aiMsg:   ChatMessage = { role: "assistant", content: "",   id: nextId() };
    setMessages(p => [...p.slice(0, at), userMsg, aiMsg]);
    await streamReply({ text, ...lastContext.current, model, replaceLast: true }, aiMsg.id);
  }, [streaming, streamReply]);

  const clear = useCallback(() => {
    setMessages([]);
    apiFetch(`${API}/api/chat/session/${sessionId}`, { method: "DELETE" }).catch(() => {});
  }, [sessionId]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return { messages, streaming, send, regenerate, editLast, clear, stop, setMessages };
}
