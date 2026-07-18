import { useState, useEffect, useRef, useCallback } from "react";
import ModelPicker from "../components/ModelPicker";
import { InputBar } from "../components/InputBar";
import { Sidebar } from "../components/Sidebar";
import { ResearchProgress } from "../components/research/ResearchProgress";
import { ResearchResult, type ResearchResultData } from "../components/research/ResearchResult";
import { SUGGESTIONS } from "../config/tools";
import { useChatHistory } from "../hooks/useChatHistory";
import { useResearch, type ResearchProgressItem } from "../hooks/useResearch";
import type { ModelSelection } from "../types";

interface ResearchMessage {
  id: string;
  query: string;
  phase: string;
  progress: ResearchProgressItem[];
  /** Loosely typed to match useResearch.ts's ResearchPatchState — the hook
   *  doesn't know the result shape, only this page (via ResearchResult) does. */
  result: unknown;
  errMsg: string;
}

const EMPTY_MSG = (): ResearchMessage => ({ id: Math.random().toString(36).slice(2), query: "", phase: "searching", progress: [], result: null, errMsg: "" });

export function ResearchPage() {
  const { runSearch, abort } = useResearch();
  const { sessions, activeId, setActiveId, addSession, removeSession, clearAll } = useChatHistory("research");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [model, setModel]             = useState<ModelSelection | null>(null);
  const [messages, setMessages]       = useState<ResearchMessage[]>([]);
  const [followUps, setFollowUps]     = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const accentColor = "#7C9EFF";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Update a specific message slot by id.
  // patch can be:
  //   - plain object  { phase, progress, ... }  → merged into message
  //   - function      prev => ({ progress: ... }) → called with current msg,
  //                   result is merged (NOT replaced) so unchanged fields survive
  const updateMsg = useCallback((id: string, patch: Partial<ResearchMessage> | ((prev: ResearchMessage) => Partial<ResearchMessage>)) => {
    setMessages(prev => prev.map(m => {
      if (m.id !== id) return m;
      const delta = typeof patch === "function" ? patch(m) : patch;
      const next  = { ...m, ...delta };
      // Extract follow-up questions when research finishes
      const followUpQuestions = (delta.result as ResearchResultData | null | undefined)?.follow_up_questions;
      if (followUpQuestions?.length) {
        setFollowUps(followUpQuestions);
      }
      return next;
    }));
  }, []);

  // Start a brand-new research session (new sidebar entry, clears history)
  const handleSearch = (q: string) => {
    const text = q;
    if (!text.trim()) return;
    abort();
    setFollowUps([]);
    setMessages([]);
    const sid = Math.random().toString(36).slice(2);
    addSession(sid, text);
    const msg = { ...EMPTY_MSG(), query: text };
    setMessages([msg]);
    runSearch(text, patch => updateMsg(msg.id, patch), model);
  };

  // Follow-up: appends a new result below the previous ones, keeps history
  const handleFollowUp = (q: string) => {
    if (!q.trim()) return;
    setFollowUps([]);
    const msg = { ...EMPTY_MSG(), query: q };
    setMessages(prev => [...prev, msg]);
    runSearch(q, patch => updateMsg(msg.id, patch), model);
  };

  // InputBar: new search if no history yet, follow-up otherwise
  const handleInputSend = (text: string) => {
    if (!text.trim()) return;
    setFollowUps([]);
    if (messages.length === 0) {
      handleSearch(text);
    } else {
      handleFollowUp(text);
    }
  };

  const isLoading = messages.some(m => m.phase === "searching" || m.phase === "synthesizing");
  const hasContent = messages.length > 0;

  const handleNewResearch = () => {
    abort(); setFollowUps([]); setMessages([]);
    setActiveId(null);
  };

  const sidebarProps = {
    open: sidebarOpen, onToggle: () => setSidebarOpen(o => !o),
    sessions, activeId,
    onSelect: (s: { id: string }) => setActiveId(s.id),
    onDelete: removeSession,
    onClearAll: clearAll,
    onNewChat: handleNewResearch,
    toolLabel: "Research",
    toolColor: accentColor,
  };

  return (
    <div className="app-layout">
    <Sidebar {...sidebarProps} />
    <div className="app-main">
    <div className="page tool-page page-entered">
      <header className="tool-header">
        <div className="tool-title-wrap">
          <span className="tool-title-icon" style={{ color: accentColor }}>🔍</span>
          <span className="tool-title-text">Research</span>
        </div>
        <ModelPicker tool="research" value={model} onChange={setModel} />
        <button className="clear-btn" onClick={handleNewResearch}>Reset</button>
      </header>

      <div className="input-wrap" style={{ paddingBottom: 12 }}>
        <InputBar
          onSend={q => handleSearch(q)}
          streaming={isLoading}
          onStop={abort}
          placeholder="Nhập chủ đề nghiên cứu…"
          accentColor={accentColor}
        />
      </div>

      <div className="chat-area chat-active" style={{ paddingTop: 8 }}>

        {/* Empty state */}
        {messages.length === 0 && (
          <div className="tool-suggestions">
            <p className="tool-suggestions-label">Thử ngay</p>
            {SUGGESTIONS.research.map(s => (
              <button key={s} className="tool-suggestion-pill"
                style={{ borderColor: accentColor + "44" }}
                onClick={() => handleSearch(s)}>
                <span style={{ color: accentColor }}>›</span> {s}
              </button>
            ))}
          </div>
        )}

        {/* Conversation: render each message in order */}
        {messages.map((msg) => (
          <div key={msg.id} className="rs-conversation-item">
            {/* User query bubble */}
            <div className="rs-query-bubble">
              <span className="rs-query-text">{msg.query}</span>
            </div>

            {/* Searching / synthesizing state */}
            {(msg.phase === "searching" || msg.phase === "synthesizing") && (
              <div>
                <ResearchProgress progress={msg.progress} />
                {msg.phase === "synthesizing" && (
                  <div className="synth-notice">Synthesizing with AI…</div>
                )}
              </div>
            )}

            {/* Done */}
            {msg.phase === "done" && !!msg.result && (
              <ResearchResult result={msg.result as ResearchResultData} model={model} />
            )}

            {/* Error */}
            {msg.phase === "error" && (
              <div className="rp-error">
                <div>⚠️ {msg.errMsg || "Research thất bại."}</div>
                <button className="clear-btn" style={{ marginTop: 10 }}
                  onClick={() => runSearch(msg.query, patch => updateMsg(msg.id, patch), model)}>
                  Thử lại
                </button>
              </div>
            )}
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {hasContent && (
        <div className="rs-bottom-wrap">
          {followUps.length > 0 && (
            <div className="rs-followup-bar">
              {followUps.map((q, i) => (
                <button key={i} className="followup-pill" onClick={() => handleFollowUp(q)}>{q}</button>
              ))}
            </div>
          )}
          <InputBar
            onSend={handleInputSend}
            streaming={isLoading}
            onStop={abort}
            placeholder="Hỏi thêm về kết quả nghiên cứu…"
            accentColor={accentColor}
          />
        </div>
      )}
    </div>
    </div>
    </div>
  );
}
