import { useState, useCallback } from "react";
import { historyKey, loadHistory, saveHistory, type Session } from "../lib/storage";

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
