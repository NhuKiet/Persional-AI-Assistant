// Cho phép override endpoint backend lúc build qua biến Vite VITE_API_URL
// (dùng khi đóng gói Docker / deploy). Không đặt thì giữ mặc định localhost
// như trước — dev chạy tay không cần cấu hình gì thêm.
const _env = import.meta.env as Record<string, string | undefined>;
export const API = _env.VITE_API_URL ?? "http://127.0.0.1:8000";

/** Header chống CSRF — khớp CLIENT_HEADER trong backend/app/core/csrf.py.
 *  Backend từ chối POST/PUT/PATCH/DELETE vào /api/* thiếu header này: trang
 *  web lạ không gửi được header tuỳ chỉnh cross-origin nếu CORS không duyệt. */
export const CLIENT_HEADER = "X-KiNg-Client";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** fetch() tới backend. Mọi lời gọi backend đều đi qua đây (có test canh):
 *  request thay đổi dữ liệu được gắn CLIENT_HEADER; GET giữ nguyên để khỏi
 *  tốn thêm một lượt preflight CORS. */
export function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  if (SAFE_METHODS.has((init?.method ?? "GET").toUpperCase())) {
    return init ? fetch(url, init) : fetch(url);
  }
  const headers = new Headers(init?.headers);
  headers.set(CLIENT_HEADER, "web");
  return fetch(url, { ...init, headers });
}

/** Id phiên ngẫu nhiên, dùng chung cho mọi tool. */
export const SESSION_ID = (): string => Math.random().toString(36).slice(2);
