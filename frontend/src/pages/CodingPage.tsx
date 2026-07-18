import { useState, useEffect, useRef, useCallback } from "react";
import ModelPicker from "../components/ModelPicker";
import { MicButton } from "../components/MicButton";
import { Message } from "../components/Message";
import { Sidebar } from "../components/Sidebar";
import { CodingResult } from "../components/coding/CodingResult";
import { EventRow } from "../components/coding/EventRow";
import { FileUploadZone, type UploadedFile } from "../components/coding/FileUploadZone";
import { PhaseBar } from "../components/coding/PhaseBar";
import { SUGGESTIONS } from "../config/tools";
import { useChatHistory } from "../hooks/useChatHistory";
import { useCoding } from "../hooks/useCoding";
import { useDragResize } from "../hooks/useDragResize";
import { API } from "../lib/api";
import type { ModelSelection } from "../types";

export function CodingPage() {
  const { phase, events, plan, codes, output, artifacts, finalMsg, success, heartbeat, chatMsgs, planStream, codeStream, installing, testOutput, review, sessionId, run, reset, clearChat } = useCoding();
  const { sessions, activeId, setActiveId, addSession, removeSession, clearAll } = useChatHistory("coding");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [input, setInput]     = useState("");
  const [mode, setMode]       = useState<"agent" | "chat">("agent");
  const [model, setModel]     = useState<ModelSelection | null>(null);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);
  const accentColor = "#A8E6A3";
  const isRunning  = ["thinking", "planning", "generating", "executing", "debugging"].includes(phase);
  const { pct, containerRef, onMouseDown } = useDragResize();
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [showUpload, setShowUpload] = useState(false);

  const handleAddFile = useCallback((fileData: UploadedFile) => {
    setUploadedFiles(p => [...p.filter(f => f.name !== fileData.name), fileData]);
  }, []);

  const handleRemoveFile = useCallback(async (name: string) => {
    try { await fetch(`${API}/api/coding/file/${encodeURIComponent(name)}?session_id=${encodeURIComponent(sessionId)}`, { method: "DELETE" }); } catch {}
    setUploadedFiles(p => p.filter(f => f.name !== name));
  }, [sessionId]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [events, output, chatMsgs, codes]);

  const handleSend = (text?: string) => {
    if (!text?.trim() || isRunning) return;
    if (!plan && codes.length === 0 && chatMsgs.length === 0) {
      const sid = Math.random().toString(36).slice(2);
      addSession(sid, text.trim());
    }
    run(text.trim(), mode === "chat", uploadedFiles, model);
    setInput("");
  };

  const hasResult = plan || planStream || codes.length > 0 || output || artifacts.length > 0;

  const handleNewCoding = () => { reset(); clearChat(); setActiveId(null); };

  const codingSidebarProps = {
    open: sidebarOpen, onToggle: () => setSidebarOpen(o => !o),
    sessions, activeId,
    onSelect: (s: { id: string }) => setActiveId(s.id),
    onDelete: removeSession,
    onClearAll: clearAll,
    onNewChat: handleNewCoding,
    toolLabel: "Coding",
    toolColor: accentColor,
  };

  return (
    <div className="app-layout">
    <Sidebar {...codingSidebarProps} />
    <div className="app-main">
    <div className="page tool-page page-entered coding-layout">
      {/* Header */}
      <header className="tool-header">
        <div className="tool-title-wrap">
          <span className="tool-title-icon" style={{ color: accentColor }}>💻</span>
          <span className="tool-title-text">Coding Agent</span>
        </div>
        <ModelPicker tool="coding" value={model} onChange={setModel} />
        <button className="clear-btn" onClick={handleNewCoding}>Reset</button>
      </header>

      {/* Mode toggle */}
      <div className="coding-mode-bar">
        <button className={`mode-btn ${mode === "agent" ? "mode-active" : ""}`} onClick={() => setMode("agent")} style={{ "--accent": accentColor } as React.CSSProperties}>
          <span className="mode-icon">⟳</span> Code chat
        </button>
        <button className={`mode-btn ${mode === "chat" ? "mode-active" : ""}`} onClick={() => setMode("chat")} style={{ "--accent": accentColor } as React.CSSProperties}>
          <span className="mode-icon">⚡</span> Quick chat
        </button>
        <div className="mode-hint">
          {mode === "agent" ? "Plan → Generate → Execute → Debug tự động" : "Hỏi về code, giải thích, review"}
        </div>
        <button
          className={`upload-toggle-btn ${showUpload ? "upload-toggle-active" : ""} ${uploadedFiles.length > 0 ? "upload-toggle-has-files" : ""}`}
          onClick={() => setShowUpload(o => !o)}
          title="Upload file dữ liệu"
        >
          📂 {uploadedFiles.length > 0 ? `${uploadedFiles.length} file` : "Upload"}
        </button>
      </div>

      {/* File upload panel */}
      {showUpload && (
        <FileUploadZone
          files={uploadedFiles}
          onAdd={handleAddFile}
          onRemove={handleRemoveFile}
          sessionId={sessionId}
        />
      )}

      {/* Body: two-column when result exists */}
      <div
        ref={containerRef}
        className={`coding-body ${hasResult ? "coding-split" : ""}`}
        style={hasResult ? ({ "--left-pct": `${pct}%` } as React.CSSProperties) : {}}
      >

        {/* LEFT: conversation + status */}
        <div className="coding-left">

          {/* Suggestions when idle */}
          {phase === "idle" && !chatMsgs.length && (
            <div className="tool-suggestions">
              <p className="tool-suggestions-label">Try one</p>
              {SUGGESTIONS.coding.map(s => (
                <button key={s} className="tool-suggestion-pill" style={{ borderColor: accentColor + "44" }}
                  onClick={() => handleSend(s)}>
                  <span style={{ color: accentColor }}>›</span> {s}
                </button>
              ))}
            </div>
          )}

          {/* Agent mode: phase bar + event log */}
          {mode === "agent" && (phase !== "idle" || events.length > 0) && (
            <div className="agent-log">
              <PhaseBar phase={phase} success={success} />
              {heartbeat && (
                <div className="heartbeat-row">
                  <span className="heartbeat-dot" />
                  <span className="heartbeat-msg">{heartbeat}</span>
                </div>
              )}
              <div className="event-log">
                {events.map((ev, i) => (
                  <EventRow key={i} ev={ev} accentColor={accentColor} />
                ))}
              </div>
              {phase === "done" && (
                <div className={`final-banner ${success ? "banner-ok" : "banner-fail"}`}>
                  {success ? "✓" : "✗"} {finalMsg}
                </div>
              )}
              {phase === "error" && (
                <div className="banner-fail" style={{ marginTop: 8, padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>
                  ⚠️ {finalMsg}
                </div>
              )}
            </div>
          )}

          {/* Chat mode: messages */}
          {mode === "chat" && chatMsgs.length > 0 && (
            <div className="messages" style={{ paddingTop: 8 }}>
              {chatMsgs.map(m => <Message key={m.id} msg={m} accentColor={accentColor} />)}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Drag divider */}
        {hasResult && (
          <div className="resize-divider" onMouseDown={onMouseDown} onTouchStart={onMouseDown} title="Kéo để thay đổi kích thước">
            <div className="resize-handle" />
          </div>
        )}

        {/* RIGHT: code + output result */}
        {hasResult && (
          <div className="coding-right">
            <CodingResult codes={codes} output={output} artifacts={artifacts} plan={plan} phase={phase} finalMsg={finalMsg} success={success} planStream={planStream} codeStream={codeStream} installing={installing} testOutput={testOutput} review={review} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="input-wrap" style={{ paddingTop: 8 }}>
        <div className="coding-input-wrap">
          <div className="input-bar" style={{ opacity: isRunning ? 0.5 : 1 }}>
            <textarea
              ref={inputRef}
              className="input-textarea"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(input); } }}
              placeholder={mode === "agent" ? "Mô tả task cần làm (Python)…" : "Hỏi về code, giải thích thuật toán…"}
              rows={1}
              disabled={isRunning}
            />
            <MicButton onTranscript={t => setInput(v => (v ? v + " " + t : t))} disabled={isRunning} />
            <button className="input-send" onClick={() => handleSend(input)} disabled={isRunning || !input.trim()}
              style={{ background: isRunning ? "#2a2a2e" : accentColor }}>
              {isRunning
                ? <span className="mini-spinner" />
                : <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M1 7.5h13M8 1.5l6 6-6 6" stroke="#000" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </button>
          </div>
          {isRunning && (
            <div className="running-notice">
              <span className="synth-dot" /> Agent đang chạy — chờ hoàn thành trước khi gửi tiếp...
            </div>
          )}
        </div>
      </div>
    </div>
    </div>
    </div>
  );
}
