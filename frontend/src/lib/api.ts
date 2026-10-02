// Backend được gọi CÙNG ORIGIN với trang (đường dẫn tương đối "/api/…"): dev
// qua proxy của Vite (vite.config.js), Docker qua nginx (nginx.conf). Cùng
// origin thì cookie đăng nhập (HttpOnly, SameSite=Strict) đi kèm mọi request —
// kể cả những request trình duyệt tự gửi như react-pdf tải file hay <img> —
// mà không cần CORS có credentials. VITE_API_URL chỉ để trỏ sang backend ở
// origin khác khi thật cần (khi đó đăng nhập bằng cookie sẽ không chạy).
const _env = import.meta.env as Record<string, string | undefined>;
export const API = _env.VITE_API_URL ?? "";

/** Header chống CSRF — khớp CLIENT_HEADER trong backend/app/core/csrf.py.
 *  Backend từ chối POST/PUT/PATCH/DELETE vào /api/* thiếu header này: trang
 *  web lạ không gửi được header tuỳ chỉnh cross-origin nếu CORS không duyệt. */
export const CLIENT_HEADER = "X-KiNg-Client";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Phát trên window khi câu trả lời "tôi là ai" có thể đã đổi — AuthProvider
 *  (hooks/useAuth.tsx) nghe để hỏi lại /api/auth/me. */
export const AUTH_CHANGED = "king:auth-changed";

// Những request tiêu một lượt dùng thử của khách (GUEST_ROUTES ở
// backend/app/core/auth.py, cột True): sau mỗi lần, số lượt còn lại đổi.
const TRIAL_TURN = /\/api\/(chat\/stream|pdf\/stream|pdf\/summarize|hmer\/recognize)$/;

function signalAuthChange(method: string, url: string, response: Response): void {
  const spentTurn = method === "POST" && TRIAL_TURN.test(url.split("?")[0]);
  if (spentTurn || response.status === 401 || response.status === 429) {
    window.dispatchEvent(new Event(AUTH_CHANGED));
  }
}

/** fetch() tới backend. Mọi lời gọi backend đều đi qua đây (có test canh):
 *  request thay đổi dữ liệu được gắn CLIENT_HEADER; GET giữ nguyên để khỏi
 *  tốn thêm một lượt preflight CORS. */
export function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  let pending: Promise<Response>;
  if (SAFE_METHODS.has(method)) {
    pending = init ? fetch(url, init) : fetch(url);
  } else {
    const headers = new Headers(init?.headers);
    headers.set(CLIENT_HEADER, "web");
    pending = fetch(url, { ...init, headers });
  }
  return pending.then(response => {
    signalAuthChange(method, url, response);
    return response;
  });
}

/** Id phiên ngẫu nhiên, dùng chung cho mọi tool. */
export const SESSION_ID = (): string => Math.random().toString(36).slice(2);
