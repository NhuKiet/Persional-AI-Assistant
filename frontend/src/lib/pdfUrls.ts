import { API } from "./api";

/** URL to fetch the raw PDF bytes for viewing. */
export function pdfRawUrl(filename: string): string {
  return `${API}/api/pdf/raw/${encodeURIComponent(filename)}`;
}

/** URL to delete an uploaded PDF, scoping the conversation clear to a session. */
export function pdfDeleteUrl(filename: string, sessionId: string): string {
  return `${API}/api/pdf/file/${encodeURIComponent(filename)}?session_id=${encodeURIComponent(sessionId)}`;
}

/** The name to show for an uploaded PDF. A guest's upload is stored as
 *  "<16 hex>_<name>" so guests can't open each other's files by name
 *  (backend/app/features/pdf/router.py); the prefix means nothing to people. */
export function displayPdfName(filename: string): string {
  return filename.replace(/^[0-9a-f]{16}_/, "");
}
