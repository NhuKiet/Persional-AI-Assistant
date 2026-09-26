import type { ReactNode } from "react";
import { Message } from "./Message";
import { useStickToBottom } from "../hooks/useStickToBottom";
import type { ChatMessage } from "../types";

interface ChatTranscriptProps {
  messages: ChatMessage[];
  streaming: boolean;
  accentColor: string;
  /** Classes of the scroll box (e.g. "chat-area chat-active"). */
  className?: string;
  /** Rendered above the messages inside the scroll box (suggestions). */
  before?: ReactNode;
  onRegenerate?: () => void;
  onEdit?: (text: string) => void;
}

/** A chat conversation in its scroll box: the messages, Tạo lại on the latest
 *  answer, Sửa on the latest question, and a "Tin mới" button when the
 *  reader has scrolled up while a reply streams in. */
export function ChatTranscript({
  messages, streaming, accentColor, className, before, onRegenerate, onEdit,
}: ChatTranscriptProps) {
  const last = messages.length - 1;
  // A new last message is a new turn the user started: follow it.
  const { ref, showJump, jumpToBottom } = useStickToBottom<HTMLDivElement>(messages, messages[last]?.id);

  let lastQuestion = -1;
  for (let i = last; i >= 0; i--) if (messages[i].role === "user") { lastQuestion = i; break; }

  return (
    <div className={className} ref={ref}>
      {before}
      <div className="messages">
        {messages.map((m, i) => (
          <Message
            key={m.id}
            msg={m}
            accentColor={accentColor}
            busy={streaming}
            onRegenerate={i === last && m.role === "assistant" ? onRegenerate : undefined}
            onEdit={i === lastQuestion ? onEdit : undefined}
          />
        ))}
      </div>
      {showJump && (
        <div className="jump-wrap">
          <button type="button" className="jump-btn" onClick={jumpToBottom} aria-label="Cuộn xuống tin mới">
            Tin mới ↓
          </button>
        </div>
      )}
    </div>
  );
}
