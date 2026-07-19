import { useEffect, useRef, type KeyboardEvent } from "react";
import { MicButton } from "../MicButton";
import { SUGGESTIONS } from "../../config/tools";
import type { ChatMessage, PdfSource } from "../../types";
import ContextPins from "./ContextPins";
import PdfMessage from "./PdfMessage";
import type { Pin } from "./SelectionLayer";

interface PdfAssistantPanelProps {
  filename: string;
  totalPages: number;
  totalChars: number;
  messages: ChatMessage[];
  pins: Pin[];
  input: string;
  streaming: boolean;
  summarizing: boolean;
  accentColor: string;
  onInputChange: (value: string) => void;
  onSend: (value: string) => void;
  onSummarize: () => void;
  onRemovePin: (index: number) => void;
  onOpenSource: (source: PdfSource) => void;
}

export default function PdfAssistantPanel({
  filename,
  totalPages,
  totalChars,
  messages,
  pins,
  input,
  streaming,
  summarizing,
  accentColor,
  onInputChange,
  onSend,
  onSummarize,
  onRemovePin,
  onOpenSource,
}: PdfAssistantPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const busy = streaming || summarizing;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend(input);
    }
  };

  return (
    <div className="pdf-assistant-content">
      <div className="pdf-info-bar">
        <div className="pdf-info-left">
          <span className="pdf-info-icon">📄</span>
          <div>
            <p className="pdf-info-name">{filename}</p>
            <p className="pdf-info-meta">
              {totalPages} trang · {(totalChars / 1000).toFixed(1)}K ký tự
            </p>
          </div>
        </div>
        <button
          aria-label="Tóm tắt"
          className="pdf-summarize-btn"
          disabled={busy}
          onClick={onSummarize}
          style={{ borderColor: `${accentColor}66`, color: accentColor }}
          type="button"
        >
          {summarizing ? <><span className="rp-spinner" /> Đang tóm tắt...</> : "📋 Tóm tắt"}
        </button>
      </div>

      <ContextPins pins={pins} onRemove={onRemovePin} />

      <div className="chat-area chat-active" style={{ paddingTop: 8 }}>
        {messages.length === 0 ? (
          <div className="tool-suggestions">
            <p className="tool-suggestions-label">Thử hỏi ngay</p>
            {SUGGESTIONS.pdf.map((suggestion) => (
              <button
                className="tool-suggestion-pill"
                key={suggestion}
                onClick={() => onSend(suggestion)}
                style={{ borderColor: `${accentColor}44` }}
                type="button"
              >
                <span style={{ color: accentColor }}>›</span> {suggestion}
              </button>
            ))}
          </div>
        ) : null}
        <div className="messages">
          {messages.map((message) => (
            <PdfMessage
              key={message.id}
              message={message}
              accentColor={accentColor}
              onOpenSource={onOpenSource}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="input-wrap">
        <div className="input-bar">
          <textarea
            className="input-textarea"
            disabled={busy}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Hỏi về nội dung PDF…"
            rows={1}
            value={input}
          />
          <MicButton
            disabled={busy}
            onTranscript={(transcript) => onInputChange(input ? `${input} ${transcript}` : transcript)}
          />
          <button
            aria-label="Gửi"
            className="input-send"
            disabled={busy || !input.trim()}
            onClick={() => onSend(input)}
            style={{ background: busy ? "#2a2a2e" : accentColor }}
            type="button"
          >
            {streaming ? (
              <span style={{ fontSize: 12, color: "#fff" }}>■</span>
            ) : (
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                <path d="M1 7.5h13M8 1.5l6 6-6 6" stroke="#000" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
