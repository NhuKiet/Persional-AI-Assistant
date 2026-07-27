import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import ModelPicker from "../components/ModelPicker";
import { AppShell } from "../components/AppShell";
import { InputBar } from "../components/InputBar";
import { ResearchProgress } from "../components/research/ResearchProgress";
import { ResearchResult, type ResearchResultData } from "../components/research/ResearchResult";
import { shuffle, SUGGESTIONS } from "../config/tools";
import { fetchSessionHistory, SESSION_RECOVERY_NOTICE, useChatHistory } from "../hooks/useChatHistory";
import { useResearch, type ResearchProgressItem } from "../hooks/useResearch";
import { useTrendingSuggestions } from "../hooks/useTrendingSuggestions";
import { SESSION_ID } from "../lib/api";
import type { ModelSelection } from "../types";

/** Số gợi ý tối đa hiển thị — trộn tĩnh + trending rồi cắt bớt để không tràn UI. */
const MAX_SUGGESTIONS = 6;

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
  const [sessionId, setSessionId] = useState(() => SESSION_ID());
  const { runSearch, abort } = useResearch();
  const { sessions, activeId, setActiveId, addSession, removeSession, clearAll } = useChatHistory("research");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [model, setModel]             = useState<ModelSelection | null>(null);
  const [messages, setMessages]       = useState<ResearchMessage[]>([]);
  const [followUps, setFollowUps]     = useState<string[]>([]);
  const [notice, setNotice]           = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const accentColor = "#7C9EFF";
  const trending = useTrendingSuggestions();
  // Trộn gợi ý tĩnh với paper nổi bật hôm nay, random thứ tự mỗi lần mount —
  // vừa là gợi ý vừa cho biết gần đây có nghiên cứu gì mới.
  const suggestions = useMemo(
    () => shuffle([...SUGGESTIONS.research, ...trending]).slice(0, MAX_SUGGESTIONS),
    [trending],
  );

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
    setNotice("");
    const sid = SESSION_ID();
    setSessionId(sid);
    addSession(sid, text);
    const msg = { ...EMPTY_MSG(), query: text };
    setMessages([msg]);
    runSearch(text, sid, patch => updateMsg(msg.id, patch), model);
  };

  // Follow-up: appends a new result below the previous ones, keeps history
  // (same session — turns append to the same server-side conversation)
  const handleFollowUp = (q: string) => {
    if (!q.trim()) return;
    setFollowUps([]);
    const msg = { ...EMPTY_MSG(), query: q };
    setMessages(prev => [...prev, msg]);
    runSearch(q, sessionId, patch => updateMsg(msg.id, patch), model);
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
    setSessionId(SESSION_ID());
    setActiveId(null);
    setNotice("");
  };

  // Chọn một phiên trong sidebar: tải lại đúng lịch sử thật từ backend.
  // Mỗi lượt lưu trong lịch sử là một cặp {query, result} — dựng lại thành
  // các ResearchMessage đã "done" để hiển thị y như lúc chạy xong.
  const handleSelectSession = useCallback(async (s: { id: string }) => {
    const result = await fetchSessionHistory("research", s.id);
    if (result.status === "not_found") {
      removeSession(s.id);
      setNotice(SESSION_RECOVERY_NOTICE);
      return;
    }
    if (result.status === "error") return;
    setNotice("");
    abort();
    setFollowUps([]);
    setActiveId(s.id);
    setSessionId(s.id);
    const restored: ResearchMessage[] = [];
    for (const m of result.data.messages) {
      if (m.role === "user") {
        restored.push({ ...EMPTY_MSG(), query: typeof m.content === "string" ? m.content : "" });
      } else if (restored.length > 0) {
        restored[restored.length - 1] = {
          ...restored[restored.length - 1], phase: "done", result: m.content,
        };
      }
    }
    setMessages(restored);
  }, [removeSession, setActiveId, abort]);

  const sidebarProps = {
    open: sidebarOpen, onToggle: () => setSidebarOpen(o => !o),
    sessions, activeId,
    onSelect: handleSelectSession,
    onDelete: removeSession,
    onClearAll: clearAll,
    onNewChat: handleNewResearch,
    toolLabel: "Research",
    toolColor: accentColor,
  };

  return (
    <AppShell {...sidebarProps}>
    <div className="page tool-page page-entered">
      <header className="tool-header">
        <div className="tool-title-wrap">
          <span className="tool-title-icon" style={{ color: accentColor }}>🔍</span>
          <span className="tool-title-text">Research</span>
        </div>
        <ModelPicker tool="research" value={model} onChange={setModel} />
        <button className="clear-btn" onClick={handleNewResearch}>Reset</button>
      </header>

      {notice && (
        <div className="recovery-notice" style={{ padding: "10px 14px", margin: "8px 0", borderRadius: 8, background: "#5a3a1a22", color: "#e0a458", fontSize: 13 }}>
          {notice}
        </div>
      )}

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
            {suggestions.map(s => (
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
                  onClick={() => runSearch(msg.query, sessionId, patch => updateMsg(msg.id, patch), model)}>
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
    </AppShell>
  );
}
