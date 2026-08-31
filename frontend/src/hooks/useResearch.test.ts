import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useResearch, type ResearchPatchState } from "./useResearch";

type Patch = Partial<ResearchPatchState> | ((prev: ResearchPatchState) => Partial<ResearchPatchState>);

function makeCollector() {
  let state: ResearchPatchState = { phase: "idle", progress: [] };
  const onUpdate = (patch: Patch) => {
    const next = typeof patch === "function" ? patch(state) : patch;
    state = { ...state, ...next };
  };
  return { onUpdate, get state() { return state; } };
}

/** Build a fake fetch Response whose body streams the given SSE frames. */
function sseResponse(events: object[]): Response {
  const text = events.map(ev => `data: ${JSON.stringify(ev)}\n\n`).join("");
  const bytes = new TextEncoder().encode(text);
  let sent = false;
  const body = {
    getReader() {
      return {
        async read() {
          if (sent) return { done: true, value: undefined };
          sent = true;
          return { done: false, value: bytes };
        },
        releaseLock() {},
      };
    },
  };
  return { ok: true, status: 200, body } as unknown as Response;
}

describe("useResearch phase mapping", () => {
  it("does not switch to synthesizing on the query-expansion status event", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse([
      { type: "status", message: "Expanding query…", source: "llm" },
    ])));

    const { result } = renderHook(() => useResearch());
    const collector = makeCollector();

    await act(async () => {
      await result.current.runSearch("q", "sess-1", collector.onUpdate, null);
    });

    expect(collector.state.phase).not.toBe("synthesizing");
  });

  it("switches to synthesizing only on the dedicated 'synthesizing' event", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse([
      { type: "status", message: "Expanding query…", source: "llm" },
      { type: "status", message: "Searching web sources…", source: "web" },
      { type: "synthesizing", message: "Synthesizing with AI…", source: "llm" },
    ])));

    const { result } = renderHook(() => useResearch());
    const collector = makeCollector();

    await act(async () => {
      await result.current.runSearch("q", "sess-1", collector.onUpdate, null);
    });

    expect(collector.state.phase).toBe("synthesizing");
  });
});

describe("useResearch section_done streaming", () => {
  it("merges each section_done payload into result instead of replacing it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse([
      { type: "synthesizing", message: "Synthesizing with AI…", source: "llm" },
      { type: "section_done", section: "key_points", data: { query: "q", key_points: ["a"] } },
      { type: "section_done", section: "summaries", data: { query: "q", summary_short: "s" } },
    ])));

    const { result } = renderHook(() => useResearch());
    const collector = makeCollector();

    await act(async () => {
      await result.current.runSearch("q", "sess-1", collector.onUpdate, null);
    });

    // Second section_done must not wipe out what the first one already
    // contributed — this is what lets the answer fill in progressively
    // instead of each event clobbering the last.
    expect(collector.state.result).toEqual({
      query: "q", key_points: ["a"], summary_short: "s",
    });
    expect(collector.state.phase).toBe("synthesizing");
  });

  it("keeps section_done's accumulated result as a base for the final done event", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse([
      { type: "section_done", section: "key_points", data: { query: "q", key_points: ["a"] } },
      { type: "done", data: { query: "q", key_points: ["a"], summary_short: "final" } },
    ])));

    const { result } = renderHook(() => useResearch());
    const collector = makeCollector();

    await act(async () => {
      await result.current.runSearch("q", "sess-1", collector.onUpdate, null);
    });

    expect(collector.state.phase).toBe("done");
    expect(collector.state.result).toEqual({ query: "q", key_points: ["a"], summary_short: "final" });
  });
});
