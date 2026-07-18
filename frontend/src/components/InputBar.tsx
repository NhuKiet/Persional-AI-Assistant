import { useState, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { MicButton } from "./MicButton";

interface InputBarProps {
  onSend: (text: string) => void;
  streaming: boolean;
  onStop: () => void;
  placeholder?: string;
  accentColor?: string;
  /** Cụm công cụ (ModelPicker) đặt bên trái nút gửi. Không truyền thì không render. */
  tools?: ReactNode;
  /** Có thì hiện nút "+" đính kèm (chỉ trang có upload). Không thì ẩn. */
  onAttach?: () => void;
}

export function InputBar({ onSend, streaming, onStop, placeholder, accentColor, tools, onAttach }: InputBarProps) {
  const [val, setVal] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const submit = () => {
    if (streaming) { onStop(); return; }
    if (!val.trim()) return;
    onSend(val.trim()); setVal("");
  };
  return (
    <div className="input-bar">
      {onAttach && (
        <button type="button" className="input-attach" onClick={onAttach} aria-label="Đính kèm file">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </button>
      )}
      <textarea ref={ref} className="input-textarea" value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
        placeholder={placeholder || "Nhắn tin…"} rows={1} />
      <div className="input-actions">
        {tools && <div className="input-tools">{tools}</div>}
        <MicButton onTranscript={t => setVal(v => (v ? v + " " + t : t))} disabled={streaming} />
        <button className="input-send" onClick={submit} style={{ background: streaming ? "#2a2a2e" : accentColor }}
          aria-label={streaming ? "Dừng" : "Gửi"}>
          {streaming
            ? <span style={{ fontSize: 12, color: "#fff" }}>■</span>
            : <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true"><path d="M1 7.5h13M8 1.5l6 6-6 6" stroke="#000" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>}
        </button>
      </div>
    </div>
  );
}
