/** Lịch sử chat + sessionId lưu ở localStorage, tách theo từng tool. */

const MAX_SESSIONS = 40;

export interface Session {
  id: string;
  title: string;
  ts: number;
}

export interface HistoryGroup {
  label: string;
  items: Session[];
}

export function historyKey(tool?: string): string {
  return `king_history_${tool || "chat"}`;
}

export function loadHistory(tool?: string): Session[] {
  try { return JSON.parse(localStorage.getItem(historyKey(tool)) || "[]"); }
  catch { return []; }
}

export function saveHistory(tool: string | undefined, sessions: Session[]): void {
  try { localStorage.setItem(historyKey(tool), JSON.stringify(sessions.slice(0, MAX_SESSIONS))); }
  catch {}
}

// Persist sessionId theo tool
export function getPersistedSessionId(tool: string): string | null {
  return localStorage.getItem(`king_sid_${tool}`) || null;
}

export function persistSessionId(tool: string, id: string): void {
  try { localStorage.setItem(`king_sid_${tool}`, id); } catch {}
}

export function groupByDate(sessions: Session[]): HistoryGroup[] {
  const now = Date.now(), DAY = 86400000;
  const buckets: Record<string, Session[]> = { "Hôm nay": [], "Hôm qua": [], "7 ngày qua": [], "30 ngày qua": [], "Cũ hơn": [] };
  for (const s of sessions) {
    const d = now - s.ts;
    if      (d < DAY)      buckets["Hôm nay"].push(s);
    else if (d < 2*DAY)    buckets["Hôm qua"].push(s);
    else if (d < 7*DAY)    buckets["7 ngày qua"].push(s);
    else if (d < 30*DAY)   buckets["30 ngày qua"].push(s);
    else                    buckets["Cũ hơn"].push(s);
  }
  return Object.entries(buckets).filter(([,v]) => v.length).map(([label,items]) => ({ label, items }));
}
