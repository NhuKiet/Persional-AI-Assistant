/** Shared shapes used by hooks across tools — see ModelPicker.jsx for provenance. */

export interface ModelSelection {
  provider: string;
  model: string;
}

export interface PdfSource {
  page: number;
  chunk_index: number;
  excerpt: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  id: number;
  sources?: PdfSource[];
}
