import { useRef, useState } from "react";
import { API } from "../lib/api";
import { Markdown } from "./Markdown";

interface BubbleMessage {
  role: "user" | "assistant" | "error";
  content: string;
  images?: string[];
}

/** Bong bóng chat nổi cho ai-agent (bridge sang dự án Telegram bot riêng) —
 *  tách biệt hoàn toàn với CTA "Mở trợ lý" (đi /chat, chat riêng của KiNg).
 *  State chỉ sống trong component, mất khi reload trang. */
export function AssistantBubble() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<BubbleMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: text }]);
    setLoading(true);
    scrollToBottom();

    try {
      const res = await fetch(`${API}/api/bubble/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Có lỗi xảy ra, thử lại nhé.");
      }
      const data = await res.json();
      setMessages(prev => [...prev, { role: "assistant", content: data.reply, images: data.images }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Có lỗi xảy ra, thử lại nhé.";
      setMessages(prev => [...prev, { role: "error", content: msg }]);
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  };

  const reset = async () => {
    setMessages([]);
    try {
      await fetch(`${API}/api/bubble/reset`, { method: "POST" });
    } catch {
      // hội thoại phía client đã xoá; nếu bridge không phản hồi thì bỏ qua.
    }
  };

  return (
    <div className="bubble-root">
      {open && (
        <div className="bubble-panel">
          <div className="bubble-header">
            <span>Trợ lý cá nhân</span>
            <div className="bubble-header-actions">
              <button type="button" className="bubble-icon-btn" onClick={reset} title="Xoá hội thoại" aria-label="Xoá hội thoại">↺</button>
              <button type="button" className="bubble-icon-btn" onClick={() => setOpen(false)} title="Đóng" aria-label="Đóng">✕</button>
            </div>
          </div>
          <div className="bubble-list" ref={listRef}>
            {messages.length === 0 && (
              <div className="bubble-empty">Hỏi mình bất cứ điều gì — mail, lịch, hay chỉ là trò chuyện.</div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`bubble-msg bubble-msg-${m.role}`}>
                {m.role === "assistant" ? <Markdown text={m.content} /> : m.content}
                {m.images?.map((b64, j) => (
                  <img key={j} src={`data:image/png;base64,${b64}`} alt="screenshot" className="bubble-img" />
                ))}
              </div>
            ))}
            {loading && <div className="bubble-msg bubble-msg-assistant bubble-typing">Đang xử lý…</div>}
          </div>
          <div className="bubble-input-row">
            <input
              className="bubble-input"
              value={input}
              placeholder="Nhắn gì đó..."
              disabled={loading}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
            />
            <button type="button" className="bubble-send-btn" onClick={() => void send()} disabled={loading || !input.trim()}>
              Gửi
            </button>
          </div>
        </div>
      )}
      <button
        type="button"
        className="bubble-toggle"
        onClick={() => setOpen(v => !v)}
        aria-label={open ? "Đóng trợ lý cá nhân" : "Mở trợ lý cá nhân"}
        title="Trợ lý cá nhân"
      >
        {open ? "✕" : "💬"}
      </button>
    </div>
  );
}
