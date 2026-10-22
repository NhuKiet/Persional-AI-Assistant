/** Coding runs generated code, so it is offered only to the owner, and only
 *  where the backend can run it: the Docker sandbox answers, which is the
 *  case when the backend runs on the machine itself. The compose, Railway and
 *  public-link builds have no sandbox; guests never get it. */
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { TOOLS, VISIBLE_TOOLS } from "../config/tools";

const OPEN = { role: "owner", auth: false, guest: null };
const OWNER = { role: "owner", auth: true, guest: null };
const GUEST = {
  role: "guest", auth: true,
  guest: { enabled: true, limit: 10, remaining: 10, tools: ["chat", "pdf", "hmer", "research"], research: { limit: 3, remaining: 3 } },
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function installBackend(me: unknown, sandbox: boolean) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/api/auth/me")) return json(me);
    if (url.endsWith("/api/models")) return json({ models: [], default: null });
    if (url.includes("/api/coding/status")) {
      return json({ executor: { available: sandbox, reason: sandbox ? "ok" : "docker_unavailable" } });
    }
    return json({});
  }));
  return calls;
}

function openAt(path: string) {
  window.history.pushState({}, "", path);
  render(<App />);
}

afterEach(() => vi.unstubAllGlobals());

it("is never in the list everyone sees", () => {
  expect(VISIBLE_TOOLS.map(tool => tool.id)).not.toContain("coding");
  expect(TOOLS.find(tool => tool.id === "coding")?.needsSandbox).toBe(true);
});

describe("the Coding tool on the chat page", () => {
  it("is offered to the owner when the backend can run code", async () => {
    installBackend(OPEN, true);
    openAt("/chat");

    const coding = await screen.findByTitle(/AI coding agent/i);
    const research = screen.getByTitle(/Deep research/i);
    // Right after Research, as in TOOLS.
    expect(research.compareDocumentPosition(coding) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("stays out of sight where the backend cannot run code", async () => {
    const calls = installBackend(OWNER, false);
    openAt("/chat");

    await screen.findByTitle(/Deep research/i);
    await waitFor(() => expect(calls.some(url => url.includes("/api/coding/status"))).toBe(true));
    expect(screen.queryByTitle(/AI coding agent/i)).toBeNull();
  });

  it("is never offered to a guest, and the sandbox is not even asked", async () => {
    const calls = installBackend(GUEST, true);
    openAt("/chat");

    await screen.findByRole("status", { name: "Chế độ dùng thử" });
    expect(screen.queryByTitle(/AI coding agent/i)).toBeNull();
    expect(calls.some(url => url.includes("/api/coding/status"))).toBe(false);
  });
});
