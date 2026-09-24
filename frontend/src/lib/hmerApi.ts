import { API } from "./api";

export interface HmerStatus {
  configured: boolean;
  checkpoint: string | null;
  checkpoint_exists: boolean;
  loaded: boolean;
  device: string | null;
  last_error: string | null;
}

export interface HmerResult {
  filename: string;
  latex: string;
  score: number;
  elapsed_ms: number;
  device: string;
}

/** Occlusion evidence over a rows × cols grid of the uploaded image. Cell
 *  (r, c) covers [c/cols, (c+1)/cols] × [r/rows, (r+1)/rows] of the image.
 *  weights[i] sums to 1, or is all zero when no_evidence[i]: hiding any
 *  single cell barely moved the model's belief in token i. */
export interface EvidenceMap {
  rows: number;
  cols: number;
  weights: number[][];
  no_evidence: boolean[];
}

export interface HmerExplanation {
  tokens: string[];
  token_probs: number[];
  evidence: EvidenceMap;
  elapsed_ms: number;
}

export const hmerImageUrl = (filename: string): string =>
  `${API}/api/hmer/images/${encodeURIComponent(filename)}`;

/** Turns the backend's reason into the sentence shown under the dropzone.
 *
 * Kept pure and exported so the mapping is testable without a server: the
 * whole point of the 503 body is that it names what an operator must fix,
 * and a generic "đã xảy ra lỗi" would throw that away.
 */
export function describeStatus(status: HmerStatus | null): string | null {
  if (!status) return null;
  if (!status.configured) {
    return "Chưa cấu hình HMER_CHECKPOINT trong .env — nhận dạng đang tắt.";
  }
  if (!status.checkpoint_exists) {
    return `Không tìm thấy checkpoint tại "${status.checkpoint}".`;
  }
  if (status.last_error) return status.last_error;
  return null;
}

export async function fetchHmerStatus(): Promise<HmerStatus> {
  const response = await fetch(`${API}/api/hmer/status`);
  if (!response.ok) throw new Error(`Không đọc được trạng thái (${response.status})`);
  return response.json();
}

/** The backend puts an actionable reason in `detail` (400 bad input, 503
 *  model unavailable). Surface it rather than the bare status. */
async function errorDetail(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    if (body?.detail) return String(body.detail);
  } catch {
    // Non-JSON error body — keep the fallback.
  }
  return `${fallback} (${response.status})`;
}

export async function recognizeImage(file: File): Promise<HmerResult> {
  const form = new FormData();
  form.append("file", file);

  const response = await fetch(`${API}/api/hmer/recognize`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) throw new Error(await errorDetail(response, "Nhận dạng thất bại"));
  return response.json();
}

/** Occlusion evidence for an image already recognized. A separate call so
 *  the LaTeX never waits for the ~65 extra forward passes it takes. */
export async function explainImage(
  filename: string,
  latex: string,
  signal?: AbortSignal,
): Promise<HmerExplanation> {
  const response = await fetch(`${API}/api/hmer/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, latex }),
    signal,
  });

  if (!response.ok) throw new Error(await errorDetail(response, "Không tính được vùng mô hình dựa vào"));
  return response.json();
}
