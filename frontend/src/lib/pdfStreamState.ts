import type { ChatMessage, PdfSource } from "../types";

export type PdfStreamEvent =
  | { type: "sources"; sources: PdfSource[] }
  | { type: "token"; content: string }
  | { type: "error"; message: string; code?: "pdf_not_found" }
  | { type: "done"; message: string };

export function applyPdfStreamEvent(
  messages: ChatMessage[],
  assistantId: number,
  event: PdfStreamEvent,
): ChatMessage[] {
  if (event.type === "done") return messages;

  return messages.map((message) => {
    if (message.id !== assistantId) return message;
    if (event.type === "sources") return { ...message, sources: event.sources };
    if (event.type === "token") return { ...message, content: message.content + event.content };

    const prefix = message.content ? `${message.content}\n\n` : "";
    return { ...message, content: `${prefix}⚠️ ${event.message}` };
  });
}
