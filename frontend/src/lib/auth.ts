import { API, apiFetch, AUTH_CHANGED } from "./api";

export { AUTH_CHANGED };

/** GET /api/auth/me — backend/app/features/auth/router.py. */
export interface GuestInfo {
  enabled: boolean;
  limit: number;
  remaining: number;
  /** Tool ids a guest may try ("chat", "pdf", "hmer"). */
  tools: string[];
}

export interface AuthState {
  role: "owner" | "guest";
  /** false = the backend runs without a password: everyone is the owner. */
  auth: boolean;
  guest: GuestInfo | null;
}

/** Until /me answers, and if it can't: behave as the app always has. The
 *  backend enforces access either way; this only decides what to show. */
export const OPEN: AuthState = { role: "owner", auth: false, guest: null };

export function parseAuth(data: unknown): AuthState | null {
  const d = data as Partial<AuthState> | null;
  if (!d || (d.role !== "owner" && d.role !== "guest") || typeof d.auth !== "boolean") return null;
  const g = d.guest as Partial<GuestInfo> | null | undefined;
  const guest = g
    ? {
        enabled: Boolean(g.enabled),
        limit: Number(g.limit) || 0,
        remaining: Number(g.remaining) || 0,
        tools: Array.isArray(g.tools) ? g.tools.map(String) : [],
      }
    : null;
  return { role: d.role, auth: d.auth, guest };
}

export async function fetchMe(): Promise<AuthState> {
  try {
    const response = await apiFetch(`${API}/api/auth/me`);
    return (response.ok && parseAuth(await response.json())) || OPEN;
  } catch {
    return OPEN;
  }
}

export type LoginResult = { ok: true; state: AuthState } | { ok: false; message: string };

export async function login(password: string): Promise<LoginResult> {
  try {
    const response = await apiFetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (response.status === 429) return { ok: false, message: "Thử quá nhiều lần — đợi một phút rồi thử lại." };
    const data = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, message: data?.message || "Không đăng nhập được." };
    return { ok: true, state: parseAuth(data) ?? OPEN };
  } catch {
    return { ok: false, message: "Không kết nối được máy chủ." };
  }
}

export async function logout(): Promise<AuthState> {
  try {
    const response = await apiFetch(`${API}/api/auth/logout`, { method: "POST" });
    return parseAuth(await response.json()) ?? OPEN;
  } catch {
    return OPEN;
  }
}

/** Whether a tool is usable for this visitor. */
export function canUse(state: AuthState, toolId: string): boolean {
  return state.role === "owner" || Boolean(state.guest?.enabled && state.guest.tools.includes(toolId));
}
