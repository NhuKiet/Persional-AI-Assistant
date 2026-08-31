import { useRef, useCallback, useEffect } from "react";
import { API } from "../lib/api";
import { parseSSE, readErrorResponse } from "../lib/sse";
import type { ModelSelection } from "../types";

export interface ResearchProgressItem {
  source: string;
  count: number | null;
  done: boolean;
}

export interface ResearchPatchState {
  phase: string;
  progress: ResearchProgressItem[];
  errMsg?: string;
  result?: unknown;
}

type ResearchPatch = Partial<ResearchPatchState> | ((prev: ResearchPatchState) => Partial<ResearchPatchState>);

const SESSION_BUSY_NOTICE = "Phiên đang bận (một tab/luồng khác đang gửi tin). Thử lại sau vài giây.";

/** Research pipeline streaming (SSE).
 *
 * `sessionId` is passed per-call (not bound once at hook creation) because
 * the calling page may mint a brand-new session id and use it in the very
 * same call (a fresh top-level search) — binding it as a hook-level
 * parameter would race React's render cycle. The page still owns id
 * generation/lifetime; this hook never generates one itself. */
export function useResearch() {
  const abortRef = useRef<AbortController | null>(null);

  // Run SSE stream. Calls onUpdate(patch) whenever state changes — caller
  // decides which message slot to update.
  const runSearch = useCallback(async (
    query: string,
    sessionId: string,
    onUpdate: (patch: ResearchPatch) => void,
    model: ModelSelection | null = null,
  ) => {
    if (!query.trim()) return;
    onUpdate({ phase: "searching", progress: [], errMsg: "" });
    try {
      abortRef.current = new AbortController();
      const res = await fetch(`${API}/api/research/stream`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        signal: abortRef.current.signal,
        body: JSON.stringify({ query, session_id: sessionId, provider: model?.provider ?? null, model: model?.model ?? null }),
      });
      if (res.status === 409) {
        onUpdate({ phase: "error", errMsg: SESSION_BUSY_NOTICE });
        return;
      }
      if (!res.ok) { onUpdate({ phase: "error", errMsg: await readErrorResponse(res) }); return; }
      // Accumulates across "section_done" events for THIS call only (fresh
      // per runSearch invocation, not shared across calls/messages) — each
      // event carries only the field(s) its own section just filled in, so
      // the result the caller sees needs to keep whatever earlier sections
      // already contributed.
      let partial: Record<string, unknown> = {};
      for await (const { data } of parseSSE(res.body!)) {
        try {
          const ev = JSON.parse(data);
          if (ev.type === "status") {
            // NOTE: "status" fires for many things (query expansion, per-
            // source progress, dedup/rerank…) including source "llm" for
            // "Expanding query…" — it must NOT be mistaken for synthesis.
            // The backend emits a dedicated "synthesizing" event for that.
            onUpdate(prev => ({
              progress: prev.progress.find(x => x.source === ev.source)
                ? prev.progress
                : [...prev.progress, { source: ev.source, count: null, done: false }],
            }));
          } else if (ev.type === "synthesizing") {
            onUpdate({ phase: "synthesizing" });
          } else if (ev.type === "source_done") {
            onUpdate(prev => ({
              progress: prev.progress.map(x =>
                x.source === ev.source ? { ...x, count: ev.count, done: true } : x
              ),
            }));
          } else if (ev.type === "section_done") {
            partial = { ...partial, ...ev.data };
            onUpdate({ phase: "synthesizing", result: partial });
          } else if (ev.type === "done") {
            onUpdate({ phase: "done", result: ev.data });
          } else if (ev.type === "error") {
            onUpdate({ phase: "error", errMsg: ev.message || "Unknown error" });
          }
        } catch {}
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") onUpdate({ phase: "error", errMsg: "Mất kết nối backend." });
    }
  }, []);

  // Rời trang bằng đường nào (sidebar "Trang chủ", đổi route) cũng hủy stream
  // đang chạy — không để request nghiên cứu chạy ngầm lãng phí.
  useEffect(() => () => abortRef.current?.abort(), []);

  const abort = useCallback(() => abortRef.current?.abort(), []);
  return { runSearch, abort };
}
