import { useState, useEffect, useRef, useCallback } from "react";
import ModelPicker from "../components/ModelPicker";
import { MicButton } from "../components/MicButton";
import { Message } from "../components/Message";
import { Sidebar } from "../components/Sidebar";
import { SUGGESTIONS } from "../config/tools";
import { useChatHistory } from "../hooks/useChatHistory";
import { API, SESSION_ID } from "../lib/api";
import { getPersistedSessionId, persistSessionId } from "../lib/storage";
import ContextPins from "../components/pdf/ContextPins";
import PdfViewer from "../components/pdf/PdfViewer";
import SelectionLayer, { type Pin } from "../components/pdf/SelectionLayer";
import type { ChatMessage, ModelSelection } from "../types";

interface UploadedPdf {
  filename: string;
  total_pages: number;
  total_chars: number;
}

export function PDFPage() {
  const accentColor = "#FF8C69";
  const { sessions, activeId, setActiveId, addSession, removeSession, clearAll } = useChatHistory("pdf");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [uploadedPDF, setUploadedPDF]   = useState<UploadedPdf | null>(null);
  const [uploading,   setUploading]     = useState(false);
  const [messages,    setMessages]      = useState<ChatMessage[]>([]);
  const [streaming,   setStreaming]     = useState(false);
  const [summarizing, setSummarizing]   = useState(false);
  const [input,       setInput]         = useState("");
  const [model,       setModel]         = useState<ModelSelection | null>(null);
  const sessionId  = useRef(getPersistedSessionId("pdf") || SESSION_ID());
  const bottomRef  = useRef<HTMLDivElement>(null);
  const fileRef    = useRef<HTMLInputElement>(null);

  // ── Split-view + context pins ───────────────────────────────
  const [pins, setPins]         = useState<Pin[]>([]);
  const [splitRatio, setSplit]  = useState(() => Number(localStorage.getItem("pdf-split")) || 0.5);
  const canvasesRef             = useRef(new Map<number, HTMLCanvasElement>());
  const dragSplit                = useRef(false);

  const onCanvasReady = useCallback((pageNum: number, canvas: HTMLCanvasElement) => {
    canvasesRef.current.set(pageNum, canvas);
  }, []);

  // Canvas được đánh key theo số trang, nên đổi tài liệu là chúng vô nghĩa.
  // Buộc theo filename thay vì gọi clear() ở từng chỗ đổi file (upload / đổi
  // file / phiên mới) — thêm lối đổi file thứ tư cũng không thể quên.
  useEffect(() => { canvasesRef.current.clear(); }, [uploadedPDF?.filename]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // ── Upload PDF ─────────────────────────────────────────────
  const handleUpload = async (file: File) => {
    if (!file || !file.name.toLowerCase().endsWith(".pdf")) {
      alert("Chỉ chấp nhận file PDF"); return;
    }
    if (file.size > 50 * 1024 * 1024) {
      alert("File quá lớn (tối đa 50MB)"); return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API}/api/pdf/upload`, { method: "POST", body: form });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail); }
      const data: UploadedPdf = await res.json();
      setUploadedPDF(data);
      setMessages([]);
      persistSessionId("pdf", sessionId.current);
    } catch (e) {
      alert("Upload lỗi: " + (e as Error).message);
    } finally { setUploading(false); }
  };

  // ── Summarize ──────────────────────────────────────────────
  const handleSummarize = async () => {
    if (!uploadedPDF || summarizing) return;
    setSummarizing(true);
    const aiId = Date.now();
    setMessages(p => [...p,
      { role: "user",      content: "📋 Tóm tắt toàn bộ tài liệu", id: Date.now() - 1 },
      { role: "assistant", content: "", id: aiId },
    ]);
    try {
      const res = await fetch(`${API}/api/pdf/summarize`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: uploadedPDF.filename, session_id: sessionId.current,
          provider: model?.provider ?? null, model: model?.model ?? null,
        }),
      });
      const reader = res.body!.getReader(); const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        for (const line of decoder.decode(value, { stream: true }).split("\n")) {
          if (!line.startsWith("data:")) continue;
          try {
            const ev = JSON.parse(line.slice(5).trim());
            if (ev.type === "token")
              setMessages(p => p.map(m => m.id === aiId ? { ...m, content: m.content + ev.content } : m));
          } catch {}
        }
      }
    } catch (e) {
      setMessages(p => p.map(m => m.id === aiId ? { ...m, content: "⚠️ Lỗi: " + (e as Error).message } : m));
    } finally { setSummarizing(false); }
  };

  // ── Chat ───────────────────────────────────────────────────
  const handleSend = async (text?: string, pinsOverride: Pin[] | null = null) => {
    if (!text?.trim() || !uploadedPDF || streaming) return;
    setInput("");
    setStreaming(true);
    const aiId = Date.now() + 1;
    setMessages(p => {
      // Lưu vào sidebar lịch sử khi tin đầu tiên
      if (p.length === 0) addSession(sessionId.current, uploadedPDF.filename + ": " + text);
      return [...p,
        { role: "user",      content: text, id: Date.now() },
        { role: "assistant", content: "",   id: aiId },
      ];
    });
    try {
      const pinsToSend = pinsOverride ?? pins;
      const res = await fetch(`${API}/api/pdf/stream`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text, filename: uploadedPDF.filename, session_id: sessionId.current,
          provider: model?.provider ?? null, model: model?.model ?? null, pins: pinsToSend,
        }),
      });
      setPins([]);
      const reader = res.body!.getReader(); const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        for (const line of decoder.decode(value, { stream: true }).split("\n")) {
          if (!line.startsWith("data:")) continue;
          try {
            const ev = JSON.parse(line.slice(5).trim());
            if (ev.type === "token")
              setMessages(p => p.map(m => m.id === aiId ? { ...m, content: m.content + ev.content } : m));
            if (ev.type === "error")
              setMessages(p => p.map(m => m.id === aiId ? { ...m, content: "⚠️ " + ev.message } : m));
          } catch {}
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError")
        setMessages(p => p.map(m => m.id === aiId ? { ...m, content: "⚠️ Mất kết nối." } : m));
    } finally { setStreaming(false); }
  };

  // pin từ SelectionLayer: explain/discuss/translate/pin
  const handlePin = (pin: Pin, action: string) => {
    const nextPins = [...pins, pin];
    setPins(nextPins);
    if (action === "explain")   handleSend("Giải thích vùng vừa chọn.", nextPins);
    if (action === "translate") handleSend("Dịch vùng vừa chọn sang tiếng Việt.", nextPins);
    // "discuss" và "pin": chỉ ghim, chờ user gõ thêm
  };

  // thanh kéo chia đôi màn hình
  const startSplitDrag = () => { dragSplit.current = true; };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragSplit.current) return;
      const r = Math.min(0.7, Math.max(0.3, e.clientX / window.innerWidth));
      setSplit(r);
    };
    const up = () => {
      if (dragSplit.current) localStorage.setItem("pdf-split", String(splitRatio));
      dragSplit.current = false;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [splitRatio]);

  const handleRemovePDF = async () => {
    if (!uploadedPDF) return;
    try { await fetch(`${API}/api/pdf/file/${uploadedPDF.filename}`, { method: "DELETE" }); } catch {}
    setUploadedPDF(null); setMessages([]); sessionId.current = SESSION_ID();
  };

  const handleNewPDF = () => {
    setUploadedPDF(null); setMessages([]);
    sessionId.current = SESSION_ID();
    persistSessionId("pdf", sessionId.current);
    setActiveId(null);
  };

  const pdfSidebarProps = {
    open: sidebarOpen, onToggle: () => setSidebarOpen(o => !o),
    sessions, activeId,
    onSelect: (s: { id: string }) => setActiveId(s.id),
    onDelete: removeSession,
    onClearAll: clearAll,
    onNewChat: handleNewPDF,
    toolLabel: "PDF Chat",
    toolColor: accentColor,
  };

  return (
    <div className="app-layout">
    <Sidebar {...pdfSidebarProps} />
    <div className="app-main">
    <div className="page tool-page page-entered">
      <header className="tool-header">
        <div className="tool-title-wrap">
          <span className="tool-title-icon" style={{ color: accentColor }}>📄</span>
          <span className="tool-title-text">PDF Chat</span>
        </div>
        <ModelPicker tool="pdf" value={model} onChange={setModel} />
        {uploadedPDF && (
          <button className="clear-btn" onClick={handleRemovePDF}>Đổi file</button>
        )}
      </header>

      {/* Upload zone — hiện khi chưa có PDF */}
      {!uploadedPDF && (
        <div className="pdf-upload-wrap">
          <div
            className={`pdf-drop-zone ${uploading ? "pdf-drop-loading" : ""}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); handleUpload(e.dataTransfer.files[0]); }}
          >
            <input ref={fileRef} type="file" accept=".pdf" hidden
              onChange={e => e.target.files && handleUpload(e.target.files[0])} />
            <div className="pdf-drop-icon">📄</div>
            {uploading
              ? <><p className="pdf-drop-title">Đang xử lý PDF...</p><span className="rp-spinner" /></>
              : <>
                  <p className="pdf-drop-title">Kéo thả file PDF vào đây</p>
                  <p className="pdf-drop-sub">hoặc <span className="upload-link">click để chọn file</span> · Tối đa 50MB</p>
                </>
            }
          </div>
          {/* Suggestions khi chưa upload */}
          <div className="tool-suggestions" style={{ marginTop: 16 }}>
            <p className="tool-suggestions-label">Sau khi upload bạn có thể</p>
            {["Tóm tắt toàn bộ tài liệu", "Tìm các điểm chính", "Hỏi về nội dung cụ thể", "Giải thích thuật ngữ trong tài liệu"].map(s => (
              <div key={s} className="tool-suggestion-pill" style={{ borderColor: accentColor + "44", cursor: "default" }}>
                <span style={{ color: accentColor }}>›</span> {s}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Split-view: PDF bên trái, chat bên phải */}
      {uploadedPDF && (
        <div className="pdf-split">
          <div className="pdf-pane-left" style={{ width: `${splitRatio * 100}%` }}>
            <SelectionLayer canvases={canvasesRef.current} onPin={handlePin}>
              <PdfViewer
                file={`${API}/api/pdf/raw/${encodeURIComponent(uploadedPDF.filename)}`}
                onCanvasReady={onCanvasReady}
              />
            </SelectionLayer>
          </div>
          <div className="pdf-divider" onMouseDown={startSplitDrag} />
          <div className="pdf-pane-right" style={{ width: `${(1 - splitRatio) * 100}%` }}>
            {/* File info bar */}
            <div className="pdf-info-bar">
              <div className="pdf-info-left">
                <span className="pdf-info-icon">📄</span>
                <div>
                  <p className="pdf-info-name">{uploadedPDF.filename}</p>
                  <p className="pdf-info-meta">{uploadedPDF.total_pages} trang · {(uploadedPDF.total_chars / 1000).toFixed(1)}K ký tự</p>
                </div>
              </div>
              <button
                className="pdf-summarize-btn"
                onClick={handleSummarize}
                disabled={summarizing || streaming}
                style={{ borderColor: accentColor + "66", color: accentColor }}
              >
                {summarizing ? <><span className="rp-spinner" /> Đang tóm tắt...</> : "📋 Tóm tắt"}
              </button>
            </div>

            <ContextPins pins={pins} onRemove={(i: number) => setPins((p) => p.filter((_, k) => k !== i))} />

            {/* Messages */}
            <div className="chat-area chat-active" style={{ paddingTop: 8 }}>
              {messages.length === 0 && (
                <div className="tool-suggestions">
                  <p className="tool-suggestions-label">Thử hỏi ngay</p>
                  {SUGGESTIONS.pdf.map(s => (
                    <button key={s} className="tool-suggestion-pill"
                      style={{ borderColor: accentColor + "44" }}
                      onClick={() => handleSend(s)}>
                      <span style={{ color: accentColor }}>›</span> {s}
                    </button>
                  ))}
                </div>
              )}
              <div className="messages">
                {messages.map(m => <Message key={m.id} msg={m} accentColor={accentColor} />)}
                <div ref={bottomRef} />
              </div>
            </div>

            {/* Input */}
            <div className="input-wrap">
              <div className="input-bar">
                <textarea className="input-textarea" value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(input); } }}
                  placeholder="Hỏi về nội dung PDF…" rows={1}
                  disabled={streaming || summarizing} />
                <MicButton onTranscript={t => setInput(v => (v ? v + " " + t : t))} disabled={streaming || summarizing} />
                <button className="input-send" onClick={() => handleSend(input)}
                  disabled={streaming || summarizing || !input.trim()}
                  style={{ background: (streaming || summarizing) ? "#2a2a2e" : accentColor }}>
                  {streaming
                    ? <span style={{ fontSize: 12, color: "#fff" }}>■</span>
                    : <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M1 7.5h13M8 1.5l6 6-6 6" stroke="#000" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
    </div>
  );
}
