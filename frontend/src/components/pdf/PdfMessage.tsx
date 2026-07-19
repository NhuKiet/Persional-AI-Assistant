import { Message } from "../Message";
import type { ChatMessage, PdfSource } from "../../types";
import SourceChips from "./SourceChips";

interface PdfMessageProps {
  message: ChatMessage;
  accentColor: string;
  onOpenSource: (source: PdfSource) => void;
}

export default function PdfMessage({ message, accentColor, onOpenSource }: PdfMessageProps) {
  return (
    <div className="pdf-message">
      <Message msg={message} accentColor={accentColor} />
      {message.role === "assistant" && message.sources?.length ? (
        <SourceChips sources={message.sources} onOpenSource={onOpenSource} />
      ) : null}
    </div>
  );
}
