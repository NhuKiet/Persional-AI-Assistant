import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function visibleIds() {
  vi.resetModules();
  const { VISIBLE_TOOLS } = await import("./tools");
  return VISIBLE_TOOLS.map((tool) => tool.id);
}

it("offers the handwriting tool by default", async () => {
  expect(await visibleIds()).toContain("hmer");
});

// The Railway image has no handwriting model (deploy/railway/Dockerfile).
it("hides the handwriting tool when the build turns it off", async () => {
  vi.stubEnv("VITE_HMER", "off");

  const ids = await visibleIds();

  expect(ids).not.toContain("hmer");
  expect(ids).toContain("research");
  expect(ids).toContain("pdf");
});
