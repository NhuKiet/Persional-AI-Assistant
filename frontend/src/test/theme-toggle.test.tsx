import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import App from "../App.tsx";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  window.history.pushState({}, "", "/chat");
  vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
    const u = String(url);
    const json = u.includes("/api/models")
      ? { models: [{ provider: "ollama", model: "llama3", label: "llama3 (local)" }], default: { provider: "ollama", model: "llama3" } }
      : {};
    return Promise.resolve({ ok: true, json: () => Promise.resolve(json) } as Response);
  });
});

it("nút toggle trong sidebar đổi data-theme", async () => {
  const user = userEvent.setup();
  render(<App />);
  const btn = await screen.findByRole("button", { name: /Đổi giao diện sáng\/tối/i });
  const before = document.documentElement.dataset.theme;
  await user.click(btn);
  expect(document.documentElement.dataset.theme).not.toBe(before);
});
