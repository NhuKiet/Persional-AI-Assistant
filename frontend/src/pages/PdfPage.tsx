import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { AppShell } from "../components/AppShell";
import ModelPicker from "../components/ModelPicker";
import PdfAssistantPanel from "../components/pdf/PdfAssistantPanel";
import PdfOutline from "../components/pdf/PdfOutline";
import PdfSearch from "../components/pdf/PdfSearch";
import PdfToolbar from "../components/pdf/PdfToolbar";
import PdfViewer, { type PdfViewerHandle } from "../components/pdf/PdfViewer";
import PdfWorkspace from "../components/pdf/PdfWorkspace";
import SelectionLayer, { type Pin } from "../components/pdf/SelectionLayer";
import {
  resolvePdfOutline,
  type PdfSearchPage,
  type PdfSearchResult,
  type ResolvedOutlineItem,
} from "../components/pdf/pdfDocument";
import { usePdfAssistantResize } from "../components/pdf/usePdfAssistantResize";
import { usePdfLayout, usePdfLayoutMode } from "../components/pdf/usePdfLayout";
import {
  fetchSessionHistory,
  SESSION_RECOVERY_NOTICE,
  useChatHistory,
} from "../hooks/useChatHistory";
import { API, SESSION_ID } from "../lib/api";
import { pdfDeleteUrl, pdfRawUrl } from "../lib/pdfUrls";
import { applyPdfStreamEvent, type PdfStreamEvent } from "../lib/pdfStreamState";
import { parseSSE, readErrorResponse } from "../lib/sse";
import { getPersistedSessionId, persistSessionId } from "../lib/storage";
import type { ChatMessage, ModelSelection, PdfSource } from "../types";

interface UploadedPdf {
  filename: string;
  total_pages: number;
  total_chars: number;
}

const SESSION_BUSY_NOTICE = "⚠️ Phiên đang bận (một tab/luồng khác đang gửi tin). Thử lại sau vài giây.";

export function PDFPage() {
  const accentColor = "var(--accent-pdf)";
  const { sessions, activeId, setActiveId, addSession, removeSession, clearAll } = useChatHistory("pdf");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [uploadedPDF, setUploadedPDF] = useState<UploadedPdf | null>(null);
  const [uploading, setUploading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [input, setInput] = useState("");
  const [model, setModel] = useState<ModelSelection | null>(null);
  const [notice, setNotice] = useState("");
  const [sessionId, setSessionId] = useState(
    () => getPersistedSessionId("pdf") || SESSION_ID(),
  );
  const [pins, setPins] = useState<Pin[]>([]);
  const [pdfProxy, setPdfProxy] = useState<PDFDocumentProxy | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [outline, setOutline] = useState<ResolvedOutlineItem[]>([]);
  const [searchPages, setSearchPages] = useState<PdfSearchPage[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const canvasesRef = useRef(new Map<number, HTMLCanvasElement>());
  const viewerRef = useRef<PdfViewerHandle>(null);
  const nextMessageIdRef = useRef(Date.now());
  const nextMessageId = useCallback(() => (nextMessageIdRef.current += 1), []);
  const layoutMode = usePdfLayoutMode();
  const layout = usePdfLayout(layoutMode);
  const assistantResize = usePdfAssistantResize();

  const startFreshSession = useCallback(() => {
    const newId = SESSION_ID();
    setSessionId(newId);
    persistSessionId("pdf", newId);
    setActiveId(null);
    return newId;
  }, [setActiveId]);

  const resetViewerState = useCallback(() => {
    setPdfProxy(null);
    setTotalPages(0);
    setCurrentPage(1);
    setOutline([]);
    setSearchPages([]);
    setSearchOpen(false);
    canvasesRef.current.clear();
  }, []);

  useEffect(() => {
    resetViewerState();
  }, [uploadedPDF?.filename, resetViewerState]);

  useEffect(() => {
    if (uploadedPDF) setSidebarOpen(false);
  }, [uploadedPDF]);

  useEffect(() => {
    let cancelled = false;
    if (!pdfProxy) {
      setOutline([]);
      return;
    }

    void resolvePdfOutline(pdfProxy).then((items) => {
      if (!cancelled) setOutline(items);
    }).catch(() => {
      if (!cancelled) setOutline([]);
    });

    return () => {
      cancelled = true;
    };
  }, [pdfProxy]);

  const onCanvasReady = useCallback((page: number, canvas: HTMLCanvasElement) => {
    canvasesRef.current.set(page, canvas);
  }, []);

  const handleDocumentReady = useCallback((pdf: PDFDocumentProxy, pageCount: number) => {
    setPdfProxy(pdf);
    setTotalPages(pageCount);
    setCurrentPage(1);
  }, []);

  const handleDocumentError = useCallback(() => {
    setPdfProxy(null);
    setOutline([]);
    setSearchPages([]);
  }, []);

  const handleUpload = async (file: File) => {
    if (!file || !file.name.toLowerCase().endsWith(".pdf")) {
      alert("Chỉ chấp nhận file PDF");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      alert("File quá lớn (tối đa 50MB)");
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`${API}/api/pdf/upload`, { method: "POST", body: form });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail);
      }
      const data: UploadedPdf = await response.json();
      setUploadedPDF(data);
      setMessages([]);
      setPins([]);
      persistSessionId("pdf", sessionId);
    } catch (error) {
      alert(`Upload lỗi: ${(error as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleSummarize = async () => {
    if (!uploadedPDF || summarizing) return;
    setSummarizing(true);
    const userId = nextMessageId();
    const aiId = nextMessageId();
    setMessages((current) => [
      ...current,
      { role: "user", content: "📋 Tóm tắt tài liệu", id: userId },
      { role: "assistant", content: "", id: aiId },
    ]);

    try {
      const response = await fetch(`${API}/api/pdf/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: uploadedPDF.filename,
          session_id: sessionId,
          provider: model?.provider ?? null,
          model: model?.model ?? null,
        }),
      });
      if (response.status === 409) {
        setMessages((current) => current.map((message) => (
          message.id === aiId ? { ...message, content: SESSION_BUSY_NOTICE } : message
        )));
        return;
      }
      if (!response.ok) {
        const errorMessage = await readErrorResponse(response);
        setMessages((current) => current.map((message) => (
          message.id === aiId ? { ...message, content: `⚠️ Lỗi: ${errorMessage}` } : message
        )));
        return;
      }

      for await (const { data } of parseSSE(response.body!)) {
        try {
          const event = JSON.parse(data) as {
            type: string;
            content?: string;
            message?: string;
          };
          if (event.type === "token" && event.content) {
            setMessages((current) => current.map((message) => (
              message.id === aiId
                ? { ...message, content: message.content + event.content }
                : message
            )));
          }
          if (event.type === "pdf.summary_scope_rejected" && event.message) {
            setMessages((current) => current.map((message) => (
              message.id === aiId ? { ...message, content: event.message! } : message
            )));
          }
        } catch {
          // Ignore malformed summarize events without aborting later valid events.
        }
      }
    } catch (error) {
      setMessages((current) => current.map((message) => (
        message.id === aiId
          ? { ...message, content: `⚠️ Lỗi: ${(error as Error).message}` }
          : message
      )));
    } finally {
      setSummarizing(false);
    }
  };

  const resetMissingPdf = useCallback(() => {
    setUploadedPDF(null);
    setMessages([]);
    setPins([]);
    setInput("");
    setNotice("");
    resetViewerState();
    startFreshSession();
  }, [resetViewerState, startFreshSession]);

  const handleSend = async (text?: string, pinsOverride: Pin[] | null = null) => {
    if (!text?.trim() || !uploadedPDF || streaming) return;
    setInput("");
    setStreaming(true);
    const userId = nextMessageId();
    const aiId = nextMessageId();
    setMessages((current) => {
      if (current.length === 0) {
        addSession(sessionId, `${uploadedPDF.filename}: ${text}`);
      }
      return [
        ...current,
        { role: "user", content: text, id: userId },
        { role: "assistant", content: "", id: aiId },
      ];
    });

    const pinsToSend = pinsOverride ?? pins;
    let streamFailed = false;
    try {
      const response = await fetch(`${API}/api/pdf/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          filename: uploadedPDF.filename,
          session_id: sessionId,
          provider: model?.provider ?? null,
          model: model?.model ?? null,
          pins: pinsToSend,
        }),
      });
      if (response.status === 409) {
        setMessages((current) => current.map((message) => (
          message.id === aiId ? { ...message, content: SESSION_BUSY_NOTICE } : message
        )));
        return;
      }
      if (!response.ok) {
        const errorMessage = await readErrorResponse(response);
        setMessages((current) => applyPdfStreamEvent(current, aiId, {
          type: "error",
          message: errorMessage,
        }));
        return;
      }

      for await (const { data } of parseSSE(response.body!)) {
        try {
          const event = JSON.parse(data) as PdfStreamEvent;
          if (event.type === "error" && event.code === "pdf_not_found") {
            resetMissingPdf();
            return;
          }
          if (event.type === "error") streamFailed = true;
          setMessages((current) => applyPdfStreamEvent(current, aiId, event));
          if (event.type === "done" && !streamFailed) setPins([]);
        } catch {
          // Ignore malformed chat events without discarding accumulated state.
        }
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        setMessages((current) => applyPdfStreamEvent(current, aiId, {
          type: "error",
          message: "Mất kết nối.",
        }));
      }
    } finally {
      setStreaming(false);
    }
  };

  const handlePin = (pin: Pin, action: string) => {
    const nextPins = [...pins, pin];
    setPins(nextPins);
    if (action === "explain") void handleSend("Giải thích vùng vừa chọn.", nextPins);
    if (action === "translate") void handleSend("Dịch vùng vừa chọn sang tiếng Việt.", nextPins);
  };

  const handleRemovePDF = async () => {
    if (!uploadedPDF) return;
    try {
      await fetch(pdfDeleteUrl(uploadedPDF.filename, sessionId), { method: "DELETE" });
    } catch {
      // Local reset must still be available when deletion cannot reach the backend.
    }
    setUploadedPDF(null);
    setMessages([]);
    setPins([]);
    setInput("");
    setNotice("");
    resetViewerState();
    startFreshSession();
  };

  const handleNewPDF = () => {
    setUploadedPDF(null);
    setMessages([]);
    setPins([]);
    setInput("");
    setNotice("");
    resetViewerState();
    startFreshSession();
  };

  const handleSelectSession = useCallback(async (session: { id: string }) => {
    const result = await fetchSessionHistory("pdf", session.id);
    if (result.status === "not_found") {
      removeSession(session.id);
      setNotice(SESSION_RECOVERY_NOTICE);
      return;
    }
    if (result.status === "error") return;

    setNotice("");
    setActiveId(session.id);
    setSessionId(session.id);
    const restoreBase = Date.now();
    setMessages(result.data.messages.map((message, index): ChatMessage => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content),
      id: restoreBase + index,
    })));
    nextMessageIdRef.current = restoreBase + result.data.messages.length;
  }, [removeSession, setActiveId]);

  const navigateToPage = useCallback((page: number) => {
    setCurrentPage(page);
    viewerRef.current?.scrollToPage(page);
  }, []);

  const openSearchResult = useCallback((result: PdfSearchResult) => {
    setCurrentPage(result.page);
    viewerRef.current?.highlightExcerpt(result.page, result.matchText);
  }, []);

  const openSource = useCallback((source: PdfSource) => {
    if (layoutMode === "narrow" && layout.assistantOpen) layout.toggleAssistant();
    setCurrentPage(source.page);
    viewerRef.current?.highlightExcerpt(source.page, source.excerpt);
  }, [layout, layoutMode]);

  const sidebarProps = {
    open: sidebarOpen,
    onToggle: () => setSidebarOpen((open) => !open),
    sessions,
    activeId,
    onSelect: handleSelectSession,
    onDelete: removeSession,
    onClearAll: clearAll,
    onNewChat: handleNewPDF,
    toolLabel: "PDF Chat",
    toolColor: accentColor,
  };

  return (
    <AppShell {...sidebarProps}>
      <div className="page tool-page page-entered">
        <header className="tool-header">
          <div className="tool-title-wrap">
            <span className="tool-title-icon" style={{ color: accentColor }}>📄</span>
            <span className="tool-title-text">PDF Chat</span>
          </div>
          <ModelPicker tool="pdf" value={model} onChange={setModel} />
          {uploadedPDF ? (
            <button className="clear-btn" onClick={handleRemovePDF} type="button">Đổi file</button>
          ) : null}
        </header>

        {notice ? (
          <div
            className="recovery-notice"
            style={{
              padding: "10px 14px",
              margin: "8px 0",
              borderRadius: 8,
              background: "#5a3a1a22",
              color: "#e0a458",
              fontSize: 13,
            }}
          >
            {notice}
          </div>
        ) : null}

        {!uploadedPDF ? (
          <div className="pdf-upload-wrap">
            <div
              className={`pdf-drop-zone ${uploading ? "pdf-drop-loading" : ""}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void handleUpload(event.dataTransfer.files[0]);
              }}
            >
              <input
                accept=".pdf"
                hidden
                onChange={(event) => {
                  if (event.target.files) void handleUpload(event.target.files[0]);
                }}
                ref={fileRef}
                type="file"
              />
              <div className="pdf-drop-icon">📄</div>
              {uploading ? (
                <><p className="pdf-drop-title">Đang xử lý PDF...</p><span className="rp-spinner" /></>
              ) : (
                <>
                  <p className="pdf-drop-title">Kéo thả file PDF vào đây</p>
                  <p className="pdf-drop-sub">
                    hoặc <span className="upload-link">click để chọn file</span> · Tối đa 50MB
                  </p>
                </>
              )}
            </div>
            <div className="tool-suggestions" style={{ marginTop: 16 }}>
              <p className="tool-suggestions-label">Sau khi upload bạn có thể</p>
              {[
                "Tóm tắt toàn bộ tài liệu",
                "Tìm các điểm chính",
                "Hỏi về nội dung cụ thể",
                "Giải thích thuật ngữ trong tài liệu",
              ].map((suggestion) => (
                <div
                  className="tool-suggestion-pill"
                  key={suggestion}
                  style={{ borderColor: `color-mix(in srgb, ${accentColor} 27%, transparent)`, cursor: "default" }}
                >
                  <span style={{ color: accentColor }}>›</span> {suggestion}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <PdfWorkspace
            mode={layoutMode}
            outlineOpen={layout.outlineOpen}
            assistantOpen={layout.assistantOpen}
            onCloseOverlays={layout.closeOverlays}
            assistantWidth={assistantResize.width}
            assistantContainerRef={assistantResize.containerRef}
            onAssistantResizeStart={assistantResize.onMouseDown}
            toolbar={(
              <>
                <PdfToolbar
                  filename={uploadedPDF.filename}
                  currentPage={currentPage}
                  totalPages={totalPages}
                  outlineOpen={layout.outlineOpen}
                  assistantOpen={layout.assistantOpen}
                  onNavigate={navigateToPage}
                  onPrevious={() => navigateToPage(Math.max(1, currentPage - 1))}
                  onNext={() => navigateToPage(Math.min(totalPages || 1, currentPage + 1))}
                  onZoomIn={() => viewerRef.current?.zoomIn()}
                  onZoomOut={() => viewerRef.current?.zoomOut()}
                  onFitWidth={() => viewerRef.current?.fitWidth()}
                  onToggleSearch={() => setSearchOpen((open) => !open)}
                  onToggleOutline={layout.toggleOutline}
                  onToggleAssistant={layout.toggleAssistant}
                  onChangeFile={handleRemovePDF}
                />
                {searchOpen ? (
                  <div className="pdf-search-anchor">
                    <PdfSearch
                      pages={searchPages}
                      onOpenResult={openSearchResult}
                      onClose={() => setSearchOpen(false)}
                    />
                  </div>
                ) : null}
              </>
            )}
            outline={(
              <PdfOutline
                items={outline}
                totalPages={totalPages}
                currentPage={currentPage}
                onNavigate={navigateToPage}
              />
            )}
            viewer={(
              <SelectionLayer canvases={canvasesRef.current} onPin={handlePin}>
                <PdfViewer
                  file={pdfRawUrl(uploadedPDF.filename)}
                  onCanvasReady={onCanvasReady}
                  onCurrentPageChange={setCurrentPage}
                  onDocumentError={handleDocumentError}
                  onDocumentReady={handleDocumentReady}
                  onSearchIndexReady={setSearchPages}
                  ref={viewerRef}
                />
              </SelectionLayer>
            )}
            assistant={(
              <PdfAssistantPanel
                filename={uploadedPDF.filename}
                totalPages={totalPages}
                totalChars={uploadedPDF.total_chars}
                messages={messages}
                pins={pins}
                input={input}
                streaming={streaming}
                summarizing={summarizing}
                accentColor={accentColor}
                onInputChange={setInput}
                onSend={(value) => void handleSend(value)}
                onSummarize={() => void handleSummarize()}
                onRemovePin={(index) => setPins((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                onOpenSource={openSource}
              />
            )}
          />
        )}
      </div>
    </AppShell>
  );
}
