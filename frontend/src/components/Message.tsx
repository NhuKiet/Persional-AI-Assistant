import { useState } from "react";
import { CopyButton } from "./CopyButton";
import { Markdown } from "../components/Markdown";
import type { ChatMessage, PdfSource } from "../types";

interface MessageProps {
  msg: ChatMessage;
  accentColor: string;
  /** A reply is streaming somewhere in this conversation: hide the actions
   *  that would start another one. */
  busy?: boolean;
  /** Only passed for the latest answer — regenerating an older one would
   *  rewrite history out from under the turns after it. */
  onRegenerate?: () => void;
  /** Only passed for the latest question, for the same reason. */
  onEdit?: (text: string) => void;
  /** PDF answers: `[Tr.N]` in the text become chips that open page N. */
  onOpenPage?: (source: PdfSource) => void;
}

export function Message({ msg, accentColor, busy = false, onRegenerate, onEdit, onOpenPage }: MessageProps) {
  const isUser = msg.role === "user";
  const [editing, setEditing] = useState(false);

  return (
    <div className={`msg ${isUser ? "msg-user" : "msg-ai"}`}>
      {/* accentColor có thể là var(--accent-*) (xem config/tools.ts) — ghép hậu
          tố hex kiểu accentColor + "22" không chạy được với var(), phải dùng
          color-mix để ra cùng độ mờ tương đương (22 hex ≈ 13%, 44 hex ≈ 27%). */}
      {!isUser && <div className="msg-avatar" style={{ background: `color-mix(in srgb, ${accentColor} 13%, transparent)`, borderColor: `color-mix(in srgb, ${accentColor} 27%, transparent)` }}><span style={{ color: accentColor }}>◆</span></div>}
      <div className={`msg-body${editing ? " is-editing" : ""}`}>
        {editing && onEdit ? (
          <EditBox
            initial={msg.content}
            onCancel={() => setEditing(false)}
            onSubmit={(text) => { setEditing(false); onEdit(text); }}
          />
        ) : (
          <div className={`msg-bubble ${isUser ? "bubble-user" : "bubble-ai"}`}>
            {isUser
              ? msg.content
              : msg.content
                ? <Markdown text={msg.content} pageSources={msg.sources} onOpenPage={onOpenPage} />
                /* Bong bóng assistant rỗng = đang chờ token đầu tiên. Thay ▋ cũ
                   bằng chỉ báo "đang soạn" ba chấm cho UX đỡ trống. */
                : <span className="typing-dots" role="status" aria-label="Đang soạn"><i /><i /><i /></span>}
          </div>
        )}

        {!editing && (
          <div className="msg-actions">
            {!isUser && msg.content && (
              <CopyButton text={msg.content} className="msg-action" label="Chép" copiedLabel="Đã chép" />
            )}
            {!isUser && onRegenerate && !busy && (
              <button type="button" className="msg-action" onClick={onRegenerate}>Tạo lại</button>
            )}
            {isUser && onEdit && !busy && (
              <button type="button" className="msg-action" onClick={() => setEditing(true)}>Sửa</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface EditBoxProps {
  initial: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

function EditBox({ initial, onSubmit, onCancel }: EditBoxProps) {
  const [value, setValue] = useState(initial);
  const text = value.trim();
  const canSend = text !== "" && text !== initial.trim();
  const submit = () => { if (canSend) onSubmit(text); };

  return (
    <div className="msg-edit">
      <textarea
        className="msg-edit-input"
        aria-label="Sửa câu hỏi"
        value={value}
        autoFocus
        rows={Math.min(8, Math.max(2, value.split("\n").length))}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); onCancel(); }
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
        }}
      />
      <div className="msg-edit-actions">
        <button type="button" className="msg-action" onClick={onCancel}>Huỷ</button>
        <button type="button" className="msg-action msg-action-primary" onClick={submit} disabled={!canSend}>Gửi lại</button>
      </div>
    </div>
  );
}
