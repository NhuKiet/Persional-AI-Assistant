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
