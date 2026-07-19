/**
 * Task 5 — Coding run lifecycle regressions:
 *   1. reset() must delete/cancel the session being ABANDONED, not the
 *      freshly-generated replacement id.
 *   2. Every phase during which the agent is actually working (including
 *      "testing" and "reviewing" — previously missing) must be treated as
 *      busy by the UI.
 *   3. Resetting mid-run must abort the in-flight client request, so the
 *      abandoned SSE connection closes and the backend can observe the
 *      cancellation (see tests/test_cancel_service.py for the backend half).
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App.tsx";
import { BUSY_PHASES, isBusyPhase } from "../hooks/useCoding";
import { historyKey } from "../lib/storage";

const MODELS = {
  models: [{ provider: "ollama", model: "llama3", label: "llama3 (local)" }],
  default: { provider: "ollama", model: "llama3" },
};

function neverEndingSSEBody(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"thinking"}\n\n'));
      // Intentionally never closes — simulates an agent run still in flight.
    },
  });
}

function shortDoneSSEBody(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"done","success":true,"message":"ok"}\n\n'));
      controller.close();
    },
  });
}

function readCodingHistory(): { id: string; title: string; ts: number }[] {
  try { return JSON.parse(localStorage.getItem(historyKey("coding")) || "[]"); }
  catch { return []; }
}

beforeEach(() => {
  window.history.pushState({}, "", "/coding");
});

describe("busy-phase coverage (CodingPage disables input for every working phase)", () => {
  it("BUSY_PHASES includes every phase the backend can be actively working in", () => {
    for (const phase of ["thinking", "planning", "generating", "executing", "debugging", "testing", "reviewing"] as const) {
      expect(isBusyPhase(phase)).toBe(true);
    }
    // "testing" and "reviewing" specifically regressed before this fix —
    // the busy list previously stopped at "debugging".
    expect(BUSY_PHASES).toContain("testing");
    expect(BUSY_PHASES).toContain("reviewing");
  });

  it("does not treat idle/done/error as busy", () => {
    for (const phase of ["idle", "done", "error"] as const) {
      expect(isBusyPhase(phase)).toBe(false);
    }
  });
});

describe("reset() targets the abandoned session id, not its replacement", () => {
  it("DELETEs the OLD (in-use) session id after Reset, never the freshly generated replacement", async () => {
    const deleteCalls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(((url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/models")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(MODELS) });
      }
      if (u.includes("/api/coding/stream")) {
        return Promise.resolve({ ok: true, status: 200, body: shortDoneSSEBody() });
      }
      if (u.includes("/api/coding/session/") && init?.method === "DELETE") {
        deleteCalls.push(u);
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as unknown as typeof fetch);

    const user = userEvent.setup();
    render(<App />);

    // Send one message so the session actually in use gets recorded in the
    // sidebar (and localStorage) under its real id — this is the id that
    // Reset must delete.
    const textarea = await screen.findByPlaceholderText(/Mô tả task cần làm/i);
    await user.type(textarea, "viết hàm cộng hai số{Enter}");

    await waitFor(() => expect(readCodingHistory().length).toBe(1));
    const oldSessionId = readCodingHistory()[0].id;

    await user.click(await screen.findByRole("button", { name: /^Reset$/i }));

    await waitFor(() => expect(deleteCalls).toHaveLength(1));
    expect(deleteCalls[0]).toBe(`http://localhost:8000/api/coding/session/${oldSessionId}`);
  });

  it("aborts the in-flight client request when Reset is clicked mid-run", async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");
    vi.spyOn(globalThis, "fetch").mockImplementation(((url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/models")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(MODELS) });
      }
      if (u.includes("/api/coding/stream")) {
        return Promise.resolve({ ok: true, status: 200, body: neverEndingSSEBody() });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as unknown as typeof fetch);

    const user = userEvent.setup();
    render(<App />);

    const textarea = await screen.findByPlaceholderText(/Mô tả task cần làm/i);
    await user.type(textarea, "viết hàm cộng hai số{Enter}");

    // Agent run is now in flight (never-ending SSE body keeps it "busy").
    await waitFor(() => expect(abortSpy).not.toHaveBeenCalled());

    await user.click(await screen.findByRole("button", { name: /^Reset$/i }));

    await waitFor(() => expect(abortSpy).toHaveBeenCalled());
  });
});
