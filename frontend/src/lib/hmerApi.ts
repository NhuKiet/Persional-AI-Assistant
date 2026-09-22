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

export async function recognizeImage(file: File): Promise<HmerResult> {
  const form = new FormData();
  form.append("file", file);

  const response = await fetch(`${API}/api/hmer/recognize`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    // The backend puts an actionable reason in `detail` for both 400 (bad
    // upload) and 503 (model unavailable). Surface it rather than the status.
    let detail = `Nhận dạng thất bại (${response.status})`;
    try {
      const body = await response.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      // Non-JSON error body — keep the status-code message.
    }
    throw new Error(detail);
  }

  return response.json();
}
