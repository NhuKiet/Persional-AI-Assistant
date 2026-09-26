import { useState, useCallback, useMemo } from "react";
import ModelPicker from "../components/ModelPicker";
import { ChatTranscript } from "../components/ChatTranscript";
import { InputBar } from "../components/InputBar";
import { AppShell } from "../components/AppShell";
import { ToolIcon } from "../components/ToolIcon";
import { shuffle, SUGGESTIONS } from "../config/tools";
import type { Tool } from "../config/tools";
import { useChat } from "../hooks/useChat";
import { fetchSessionHistory, SESSION_RECOVERY_NOTICE, useChatHistory } from "../hooks/useChatHistory";
import { SESSION_ID } from "../lib/api";
import type { ChatMessage, ModelSelection } from "../types";

interface ToolPageProps {
  tool: Tool;
}

export function ToolPage({ tool }: ToolPageProps) {
  const [sessionId, setSessionId] = useState(() => SESSION_ID());
  const { messages, streaming, send, regenerate, editLast, clear, stop, setMessages } = useChat(tool.id, sessionId);
  const { sessions, activeId, setActiveId, addSession, removeSession, clearAll } = useChatHistory(tool.id);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [model, setModel] = useState<ModelSelection | null>(null);
  const [notice, setNotice] = useState("");
  const suggestions = useMemo(() => shuffle(SUGGESTIONS[tool.id] || []), [tool.id]);

  const handleSend = useCallback((text: string) => {
    setNotice("");
    send(text, "", (firstMsg) => addSession(sessionId, firstMsg), "", model);
  }, [send, addSession, model, sessionId]);

  const handleClear = useCallback(() => {
    clear();
    setSessionId(SESSION_ID());
    setActiveId(null);
    setNotice("");
  }, [clear, setActiveId]);

  const handleSelectSession = useCallback(async (s: { id: string }) => {
    const result = await fetchSessionHistory(tool.id, s.id);
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
  }, [tool.id, removeSession, setActiveId, setMessages]);

  const sidebarProps = {
    open: sidebarOpen, onToggle: () => setSidebarOpen(o => !o),
    sessions, activeId,
    onSelect: handleSelectSession,
    onDelete: removeSession,
    onClearAll: clearAll,
    onNewChat: handleClear,
    toolLabel: tool.label,
    toolColor: tool.color,
  };

  return (
    <AppShell {...sidebarProps}>
        <div className="page tool-page page-entered">
          <header className="tool-header">
            <div className="tool-title-wrap"><span className="tool-title-icon" style={{ color: tool.color }}><ToolIcon tool={tool.id} size={22} /></span><span className="tool-title-text">{tool.label}</span></div>
            <button className="clear-btn" onClick={handleClear}>Xóa</button>
          </header>
          {notice && (
            <div className="recovery-notice" style={{ padding: "10px 14px", margin: "8px 16px", borderRadius: 8, background: "#5a3a1a22", color: "#e0a458", fontSize: 13 }}>
              {notice}
            </div>
          )}
          <ChatTranscript
            className="chat-area chat-active tool-chat"
            messages={messages}
            streaming={streaming}
            accentColor={tool.color}
            onRegenerate={() => regenerate(model)}
            onEdit={(text) => editLast(text, model)}
            before={messages.length === 0 && (
              <div className="tool-suggestions">
                <p className="tool-suggestions-label">Thử ngay</p>
                {suggestions.map(s => (
                  <button key={s} className="tool-suggestion-pill" style={{ borderColor: `color-mix(in srgb, ${tool.color} 27%, transparent)` }} onClick={() => handleSend(s)}>
                    <span style={{ color: tool.color }}>›</span> {s}
                  </button>
                ))}
              </div>
            )}
          />
          <div className="input-wrap"><InputBar onSend={handleSend} streaming={streaming} onStop={stop} placeholder={`${tool.label}…`} accentColor={tool.color}
            tools={<ModelPicker tool={tool.id} value={model} onChange={setModel} />} /></div>
        </div>
    </AppShell>
  );
}
