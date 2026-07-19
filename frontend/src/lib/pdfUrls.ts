import { API } from "./api";

/** URL to fetch the raw PDF bytes for viewing. */
export function pdfRawUrl(filename: string): string {
  return `${API}/api/pdf/raw/${encodeURIComponent(filename)}`;
}

/** URL to delete an uploaded PDF, scoping the conversation clear to a session. */
export function pdfDeleteUrl(filename: string, sessionId: string): string {
  return `${API}/api/pdf/file/${encodeURIComponent(filename)}?session_id=${encodeURIComponent(sessionId)}`;
}
