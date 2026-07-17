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
      {!isUser && <div className="msg-avatar" style={{ background: accentColor + "22", borderColor: accentColor + "44" }}><span style={{ color: accentColor }}>◆</span></div>}
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
