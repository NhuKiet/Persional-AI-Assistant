/**
 * The backend refuses POST/PUT/PATCH/DELETE under /api/ without the
 * X-KiNg-Client header (CSRF guard, backend/app/core/csrf.py). apiFetch adds
 * it; every call to the backend must go through apiFetch, or that feature
 * silently starts failing with 403.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { API, CLIENT_HEADER, apiFetch } from "../lib/api";

function lastCall() {
  const spy = globalThis.fetch as unknown as { mock: { calls: [string, RequestInit | undefined][] } };
  return spy.mock.calls[spy.mock.calls.length - 1];
}

function mockFetch() {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
}

describe("apiFetch", () => {
  it.each(["POST", "DELETE", "put", "PATCH"])("adds the client header to %s", async (method) => {
    mockFetch();
    await apiFetch(`${API}/api/x`, { method });

    const [, init] = lastCall();
    expect(new Headers(init?.headers).get(CLIENT_HEADER)).toBeTruthy();
  });

  it("keeps the caller's own headers and body", async () => {
    mockFetch();
    await apiFetch(`${API}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    const [url, init] = lastCall();
    const headers = new Headers(init?.headers);
    expect(url).toBe(`${API}/api/chat/stream`);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get(CLIENT_HEADER)).toBeTruthy();
    expect(init?.body).toBe("{}");
  });

  it("leaves GET requests untouched (no header, so no extra CORS preflight)", async () => {
    mockFetch();
    await apiFetch(`${API}/api/models`);

    const [, init] = lastCall();
    expect(new Headers(init?.headers).has(CLIENT_HEADER)).toBe(false);
  });
});

describe("contract: backend calls go through apiFetch", () => {
  const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return name === "test" ? [] : sourceFiles(full);
      return /\.(ts|tsx|js|jsx)$/.test(name) ? [full] : [];
    });
  }

  it("has no bare fetch() to the backend outside lib/api.ts", () => {
    const bareBackendFetch = /(?<![\w.])fetch\(\s*(`\$\{API\}|pdfDeleteUrl\(|API\s*\+)/;
    const offenders = sourceFiles(srcDir)
      .filter((file) => !file.endsWith(path.join("lib", "api.ts")))
      .filter((file) => bareBackendFetch.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(srcDir, file));

    expect(offenders).toEqual([]);
  });
});
