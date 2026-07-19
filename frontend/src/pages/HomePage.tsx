import { useState, useEffect, useRef, useCallback } from "react";
import ModelPicker from "../components/ModelPicker";
import mainlogo from "../assets/mainlogo.png";
import { AppShell } from "../components/AppShell";
import { InputBar } from "../components/InputBar";
import { Message } from "../components/Message";
import { ToolDock } from "../components/ToolDock";
import { SUGGESTIONS, toolPath } from "../config/tools";
import { ACCENT } from "../config/theme";
import { useLocation, useNavigate } from "react-router-dom";
import { useChat } from "../hooks/useChat";
import { fetchSessionHistory, SESSION_RECOVERY_NOTICE, useChatHistory } from "../hooks/useChatHistory";
import { SESSION_ID } from "../lib/api";
import type { ChatMessage, ModelSelection } from "../types";

export function HomePage() {
  const [sessionId, setSessionId] = useState(() => SESSION_ID());
  const { messages, streaming, send, clear, stop, setMessages } = useChat("chat", sessionId);
  const { sessions, activeId, setActiveId, addSession, removeSession, clearAll } = useChatHistory("chat");
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [model, setModel] = useState<ModelSelection | null>(null);
  const [notice, setNotice] = useState("");
  const chatActive = messages.length > 0;
  const bottomRef  = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const handleSend = useCallback((text: string, context = "") => {
    setNotice("");
    send(text, context, (firstMsg) => addSession(sessionId, firstMsg), "", model);
  }, [send, addSession, model, sessionId]);

  // LandingPage điều hướng tới đây kèm state.prefill khi người dùng gõ ngay ở
  // ô nhập trên trang chủ rồi bấm gửi. Gửi đúng một lần khi mount, sau đó xoá
  // state qua navigate(replace) — nếu không xoá, bấm Back rồi Forward (hoặc
  // F5 giữ state qua history) sẽ gửi lại tin nhắn cũ lần nữa.
  useEffect(() => {
    const prefill = (location.state as { prefill?: string } | null)?.prefill;
    if (prefill) {
      handleSend(prefill);
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNewChat = useCallback(() => {
    clear(); setSessionId(SESSION_ID()); setActiveId(null); setNotice("");
  }, [clear, setActiveId]);

  // Chọn một phiên trong sidebar: tải lại đúng lịch sử thật từ backend thay
  // vì chỉ đổi highlight. 404 (phiên cũ không còn trên server) → gỡ khỏi
  // danh sách + hiện thông báo khôi phục, KHÔNG đụng vào transcript hiện tại.
  const handleSelectSession = useCallback(async (s: { id: string }) => {
    const result = await fetchSessionHistory("chat", s.id);
    if (result.status === "not_found") {
      removeSession(s.id);
      setNotice(SESSION_RECOVERY_NOTICE);
      return;
    }
    if (result.status === "error") return;
    setNotice("");
    setActiveId(s.id);
    setSessionId(s.id);
    setMessages(result.data.messages.map((m, i): ChatMessage => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      id: Date.now() + i,
    })));
  }, [removeSession, setActiveId, setMessages]);

  const sidebarProps = {
    open: sidebarOpen, onToggle: () => setSidebarOpen(o => !o),
    sessions, activeId, onSelect: handleSelectSession,
    onDelete: removeSession, onClearAll: clearAll, onNewChat: handleNewChat,
  };

  return (
    <AppShell {...sidebarProps}>
        <div className="page">

          {/* Lối tắt về trang chủ khi sidebar đã đóng (sidebar cũng có nút
              này, nhưng chỉ thấy được khi mở) */}
          {!sidebarOpen && (
            <button className="workspace-home-link" onClick={() => navigate("/")}>Trang chủ</button>
          )}

          {notice && (
            <div className="recovery-notice" style={{ padding: "10px 14px", margin: "8px 16px", borderRadius: 8, background: "#5a3a1a22", color: "#e0a458", fontSize: 13 }}>
              {notice}
            </div>
          )}

          {/* Compact header khi đang chat */}
          {chatActive && (
            <header className="home-header header-compact">
              <div className="compact-header">
                <div className="compact-logo">
                  {!sidebarOpen && <div style={{ width: 36 }} />}
                  <img src={mainlogo} alt="logo" style={{ width: 20, height: 20, objectFit: "contain" }} />
                  <span className="logo-name-sm">KiNg</span>
                </div>
                <button className="clear-btn" onClick={handleNewChat}>+ Chat mới</button>
              </div>
            </header>
          )}

          {/* Messages */}
          {chatActive && (
            <div className="chat-area chat-active">
              <div className="messages">
                {messages.map(m => <Message key={m.id} msg={m} accentColor={ACCENT} />)}
                <div ref={bottomRef} />
              </div>
            </div>
          )}

          {/* Idle */}
          {!chatActive && (
            <div className="home-idle">
              <div className="home-logo">
                <div className="logo-wrap">
                  <img src={mainlogo} alt="KN Logo" className="logo-img" />
                  <span className="logo-name">KiNg</span>
                </div>
                <p className="logo-sub">Hôm nay bạn cảm thấy thế nào?</p>
              </div>
              <div className="home-center">
                <div className="input-wrap" style={{ padding: 0 }}>
                  <InputBar onSend={handleSend} streaming={streaming} onStop={stop}
                    placeholder="Hỏi KiNg bất cứ điều gì…" accentColor={ACCENT}
                    tools={<ModelPicker tool="chat" value={model} onChange={setModel} />} />
                </div>
                <ToolDock onSelect={(tool) => navigate(toolPath(tool))} visible={true} />
                <div className="suggestions-grid">
                  {SUGGESTIONS.home.map(s => (
                    <button key={s} className="suggestion-card" onClick={() => handleSend(s)}>
                      <span className="suggestion-arrow" aria-hidden="true">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M3.5 8.5L8.5 3.5M8.5 3.5H4.5M8.5 3.5V7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </span>{s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Input bar khi đang chat */}
          {chatActive && (
            <div className="input-wrap">
              <InputBar onSend={handleSend} streaming={streaming} onStop={stop}
                placeholder="Hỏi KiNg bất cứ điều gì…" accentColor={ACCENT}
                tools={<ModelPicker tool="chat" value={model} onChange={setModel} />} />
            </div>
          )}

        </div>
    </AppShell>
  );
}
