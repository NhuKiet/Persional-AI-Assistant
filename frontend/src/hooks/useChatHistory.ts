import { useState, useCallback } from "react";
import { API } from "../lib/api";
import { historyKey, loadHistory, saveHistory, type Session } from "../lib/storage";

/** Vietnamese notice shown when a sidebar entry points at a session the
 *  backend no longer has (deleted, expired, or from a previous data reset). */
export const SESSION_RECOVERY_NOTICE =
  "Phiên hội thoại này không còn tồn tại trên máy chủ và đã được gỡ khỏi danh sách lịch sử.";

export interface RestoredSession {
  session_id: string;
  feature: string;
  revision: number;
  messages: { role: string; content: unknown }[];
}

export type RestoreResult =
  | { status: "ok"; data: RestoredSession }
  | { status: "not_found" }
  | { status: "error" };

/** GET /api/<feature>/sessions/{session_id} — read-only, never locks. */
export async function fetchSessionHistory(feature: string, sessionId: string): Promise<RestoreResult> {
  try {
    const res = await fetch(`${API}/api/${feature}/sessions/${encodeURIComponent(sessionId)}`);
    if (res.status === 404) return { status: "not_found" };
    if (!res.ok) return { status: "error" };
    const data: RestoredSession = await res.json();
    return { status: "ok", data };
  } catch {
    return { status: "error" };
  }
}

/** Lịch sử phiên chat của một tool (lưu localStorage). */
export function useChatHistory(tool?: string) {
  const toolKey = tool || "chat";
  const [sessions, setSessions] = useState<Session[]>(() => loadHistory(toolKey));
  const [activeId, setActiveId] = useState<string | null>(null);

  const addSession = useCallback((id: string, firstMessage: string) => {
    const title = firstMessage.length > 50 ? firstMessage.slice(0, 50) + "…" : firstMessage;
    setSessions(prev => {
      const updated = [{ id, title, ts: Date.now() }, ...prev.filter(s => s.id !== id)];
      saveHistory(toolKey, updated);
      return updated;
    });
    setActiveId(id);
  }, [toolKey]);

  const removeSession = useCallback((id: string) => {
    setSessions(prev => {
      const u = prev.filter(s => s.id !== id);
      saveHistory(toolKey, u);
      return u;
    });
  }, [toolKey]);

  const clearAll = useCallback(() => {
    setSessions([]);
    localStorage.removeItem(historyKey(toolKey));
  }, [toolKey]);

  return { sessions, activeId, setActiveId, addSession, removeSession, clearAll };
}
