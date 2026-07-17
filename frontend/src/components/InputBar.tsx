import { useState, useEffect, useRef } from "react";
import type { ReactNode } from "react";

interface InputBarProps {
  onSend: (text: string) => void;
  streaming: boolean;
  onStop: () => void;
  placeholder?: string;
  accentColor?: string;
  /** Đặt ở hàng công cụ phía dưới ô nhập, bên trái nút gửi — chỗ của
   *  ModelPicker. Nhận children thay vì import thẳng ModelPicker để InputBar
   *  không phải biết tới model: ResearchPage/ToolPage truyền thứ khác nhau,
   *  và PdfPage/CodingPage không dùng InputBar. Không truyền gì thì hàng công
   *  cụ không render, ô nhập giữ nguyên một hàng như cũ. */
  tools?: ReactNode;
}

export function InputBar({ onSend, streaming, onStop, placeholder, accentColor, tools }: InputBarProps) {
  const [val, setVal] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const submit = () => {
    if (streaming) { onStop(); return; }
    if (!val.trim()) return;
    onSend(val.trim()); setVal("");
  };
  return (
    <div className={`input-bar${tools ? " input-bar-stacked" : ""}`}>
      <textarea ref={ref} className="input-textarea" value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
        placeholder={placeholder || "Nhắn tin…"} rows={1} />
      <div className="input-actions">
        {tools && <div className="input-tools">{tools}</div>}
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
