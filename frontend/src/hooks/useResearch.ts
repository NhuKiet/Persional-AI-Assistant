import { useRef, useCallback } from "react";
import { API } from "../lib/api";
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

/** Research pipeline streaming (SSE). */
export function useResearch() {
  const abortRef = useRef<AbortController | null>(null);

  // Run SSE stream. Calls onUpdate(patch) whenever state changes — caller
  // decides which message slot to update.
  const runSearch = useCallback(async (
    query: string,
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
        body: JSON.stringify({ query, provider: model?.provider ?? null, model: model?.model ?? null }),
      });
      if (!res.ok) { onUpdate({ phase: "error", errMsg: `Backend lỗi ${res.status}.` }); return; }
      const reader = res.body!.getReader(); const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        for (const line of decoder.decode(value, { stream: true }).split("\n")) {
          if (!line.startsWith("data:")) continue;
          try {
            const ev = JSON.parse(line.slice(5).trim());
            if (ev.type === "status") {
              const nextPhase = ev.source === "llm" ? "synthesizing" : undefined;
              onUpdate(prev => ({
                ...(nextPhase ? { phase: nextPhase } : {}),
                progress: prev.progress.find(x => x.source === ev.source)
                  ? prev.progress
                  : [...prev.progress, { source: ev.source, count: null, done: false }],
              }));
            } else if (ev.type === "source_done") {
              onUpdate(prev => ({
                progress: prev.progress.map(x =>
                  x.source === ev.source ? { ...x, count: ev.count, done: true } : x
                ),
              }));
            } else if (ev.type === "done") {
              onUpdate({ phase: "done", result: ev.data });
            } else if (ev.type === "error") {
              onUpdate({ phase: "error", errMsg: ev.message || "Unknown error" });
            }
          } catch {}
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") onUpdate({ phase: "error", errMsg: "Mất kết nối backend." });
    }
  }, []);

  const abort = useCallback(() => abortRef.current?.abort(), []);
  return { runSearch, abort };
}
