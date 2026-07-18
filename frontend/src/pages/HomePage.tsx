import { useState, useEffect, useRef, useCallback } from "react";
import ModelPicker from "../components/ModelPicker";
import mainlogo from "../assets/mainlogo.png";
import { InputBar } from "../components/InputBar";
import { Message } from "../components/Message";
import { Sidebar } from "../components/Sidebar";
import { ToolDock } from "../components/ToolDock";
import { SUGGESTIONS, toolPath } from "../config/tools";
import { ACCENT } from "../config/theme";
import { useLocation, useNavigate } from "react-router-dom";
import { useChat } from "../hooks/useChat";
import { useChatHistory } from "../hooks/useChatHistory";
import { SESSION_ID } from "../lib/api";
import type { ModelSelection } from "../types";

export function HomePage() {
  const { messages, streaming, send, clear, stop } = useChat("chat");
  const { sessions, activeId, setActiveId, addSession, removeSession, clearAll } = useChatHistory("chat");
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [model, setModel] = useState<ModelSelection | null>(null);
  const chatActive = messages.length > 0;
  const bottomRef  = useRef<HTMLDivElement>(null);
  const sessionId  = useRef(SESSION_ID());

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const handleSend = useCallback((text: string, context = "") => {
    send(text, context, (firstMsg) => addSession(sessionId.current, firstMsg), "", model);
  }, [send, addSession, model]);

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
    clear(); sessionId.current = SESSION_ID(); setActiveId(null);
  }, [clear, setActiveId]);

  const sidebarProps = {
    open: sidebarOpen, onToggle: () => setSidebarOpen(o => !o),
    sessions, activeId, onSelect: (s: { id: string }) => setActiveId(s.id),
    onDelete: removeSession, onClearAll: clearAll, onNewChat: handleNewChat,
  };

  return (
    <div className="app-layout">
      <Sidebar {...sidebarProps} />
      <div className="app-main">
        <div className="page">

          {/* Nút mở sidebar khi đã đóng */}
          {!sidebarOpen && (
            <>
              <button className="sb-open-btn" onClick={() => setSidebarOpen(true)} title="Mở sidebar">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <button className="workspace-home-link" onClick={() => navigate("/")}>Trang chủ</button>
            </>
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
      </div>
    </div>
  );
}
