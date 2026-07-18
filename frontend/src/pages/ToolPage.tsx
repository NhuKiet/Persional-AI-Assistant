import { useState, useEffect, useRef, useCallback } from "react";
import ModelPicker from "../components/ModelPicker";
import { InputBar } from "../components/InputBar";
import { Message } from "../components/Message";
import { Sidebar } from "../components/Sidebar";
import { SUGGESTIONS } from "../config/tools";
import type { Tool } from "../config/tools";
import { useChat } from "../hooks/useChat";
import { useChatHistory } from "../hooks/useChatHistory";
import { SESSION_ID } from "../lib/api";
import { getPersistedSessionId, persistSessionId } from "../lib/storage";
import type { ModelSelection } from "../types";

interface ToolPageProps {
  tool: Tool;
  onBack: () => void;
}

export function ToolPage({ tool, onBack }: ToolPageProps) {
  const { messages, streaming, send, clear, stop } = useChat(tool.id);
  const { sessions, activeId, setActiveId, addSession, removeSession, clearAll } = useChatHistory(tool.id);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [model, setModel] = useState<ModelSelection | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const handleSend = useCallback((text: string) => {
    send(text, "", (firstMsg) => addSession(sessionId_ref.current, firstMsg), "", model);
  }, [send, addSession, model]);

  // sessionId ref từ useChat không expose ra ngoài — dùng workaround:
  // persist khi có addSession callback (first message)
  const sessionId_ref = useRef(getPersistedSessionId(tool.id) || SESSION_ID());

  const handleClear = useCallback(() => {
    clear();
    sessionId_ref.current = SESSION_ID();
    persistSessionId(tool.id, sessionId_ref.current);
    setActiveId(null);
  }, [clear, setActiveId, tool.id]);

  const sidebarProps = {
    open: sidebarOpen, onToggle: () => setSidebarOpen(o => !o),
    sessions, activeId,
    onSelect: (s: { id: string }) => setActiveId(s.id),
    onDelete: removeSession,
    onClearAll: clearAll,
    onNewChat: handleClear,
    toolLabel: tool.label,
    toolColor: tool.color,
  };

  return (
    <div className="app-layout">
      <Sidebar {...sidebarProps} />
      <div className="app-main">
        <div className="page tool-page page-entered">
          <header className="tool-header">
            <button className="back-btn" onClick={onBack}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg> KiNg
            </button>
            <div className="tool-title-wrap"><span className="tool-title-icon" style={{ color: tool.color }}>{tool.icon}</span><span className="tool-title-text">{tool.label}</span></div>
            <button className="clear-btn" onClick={handleClear}>Xóa</button>
          </header>
          <div className="chat-area chat-active tool-chat">
            {messages.length === 0 && (
              <div className="tool-suggestions">
                <p className="tool-suggestions-label">Thử ngay</p>
                {(SUGGESTIONS[tool.id] || []).map(s => (
                  <button key={s} className="tool-suggestion-pill" style={{ borderColor: tool.color + "44" }} onClick={() => handleSend(s)}>
                    <span style={{ color: tool.color }}>›</span> {s}
                  </button>
                ))}
              </div>
            )}
            <div className="messages">{messages.map(m => <Message key={m.id} msg={m} accentColor={tool.color} />)}<div ref={bottomRef} /></div>
          </div>
          <div className="input-wrap"><InputBar onSend={handleSend} streaming={streaming} onStop={stop} placeholder={`${tool.label}…`} accentColor={tool.color}
            tools={<ModelPicker tool={tool.id} value={model} onChange={setModel} />} /></div>
        </div>
      </div>
    </div>
  );
}
