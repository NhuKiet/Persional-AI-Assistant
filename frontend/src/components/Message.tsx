import { Markdown } from "../components/Markdown";
import type { ChatMessage } from "../types";

interface MessageProps {
  msg: ChatMessage;
  accentColor: string;
}

export function Message({ msg, accentColor }: MessageProps) {
  const isUser = msg.role === "user";
  return (
    <div className={`msg ${isUser ? "msg-user" : "msg-ai"}`}>
      {/* accentColor có thể là var(--accent-*) (xem config/tools.ts) — ghép hậu
          tố hex kiểu accentColor + "22" không chạy được với var(), phải dùng
          color-mix để ra cùng độ mờ tương đương (22 hex ≈ 13%, 44 hex ≈ 27%). */}
      {!isUser && <div className="msg-avatar" style={{ background: `color-mix(in srgb, ${accentColor} 13%, transparent)`, borderColor: `color-mix(in srgb, ${accentColor} 27%, transparent)` }}><span style={{ color: accentColor }}>◆</span></div>}
      <div className={`msg-bubble ${isUser ? "bubble-user" : "bubble-ai"}`}>
        {isUser
          ? msg.content
          : msg.content
            ? <Markdown text={msg.content} />
            /* Bong bóng assistant rỗng = đang chờ token đầu tiên. Thay ▋ cũ
               bằng chỉ báo "đang soạn" ba chấm cho UX đỡ trống. */
            : <span className="typing-dots" role="status" aria-label="Đang soạn"><i /><i /><i /></span>}
      </div>
    </div>
  );
}
