// Cho phép override endpoint backend lúc build qua biến Vite VITE_API_URL
// (dùng khi đóng gói Docker / deploy). Không đặt thì giữ mặc định localhost
// như trước — dev chạy tay không cần cấu hình gì thêm.
const _env = import.meta.env as Record<string, string | undefined>;
export const API = _env.VITE_API_URL ?? "http://127.0.0.1:8000";

/** Id phiên ngẫu nhiên, dùng chung cho mọi tool. */
export const SESSION_ID = (): string => Math.random().toString(36).slice(2);
