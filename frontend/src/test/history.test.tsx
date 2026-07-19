/**
 * Task 4 — sidebar selection must restore REAL history from the backend
 * (not just move the highlight), and a stale (404) sidebar entry must be
 * removed with the Vietnamese recovery notice.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App.tsx";
import { historyKey } from "../lib/storage";

const MODELS = {
  models: [{ provider: "ollama", model: "llama3", label: "llama3 (local)" }],
  default: { provider: "ollama", model: "llama3" },
};

function seedChatSessions() {
  const now = Date.now();
  window.localStorage.setItem(
    historyKey("chat"),
    JSON.stringify([
      { id: "session-newer", title: "Phiên mới hơn", ts: now },
      { id: "session-older", title: "Phiên cũ hơn", ts: now - 1000 },
      { id: "session-stale", title: "Phiên đã mất", ts: now - 2000 },
    ]),
  );
}

beforeEach(() => {
  window.history.pushState({}, "", "/chat");
  seedChatSessions();

  vi.spyOn(globalThis, "fetch").mockImplementation(((url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("/api/models")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(MODELS) });
    }
    if (u.includes("/api/chat/sessions/session-older")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          session_id: "session-older", feature: "chat", revision: 2,
          messages: [
            { role: "user", content: "Câu hỏi CŨ" },
            { role: "assistant", content: "Câu trả lời CŨ" },
          ],
        }),
      });
    }
    if (u.includes("/api/chat/sessions/session-newer")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          session_id: "session-newer", feature: "chat", revision: 2,
          messages: [
            { role: "user", content: "Câu hỏi MỚI" },
            { role: "assistant", content: "Câu trả lời MỚI" },
          ],
        }),
      });
    }
    if (u.includes("/api/chat/sessions/session-stale")) {
      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ detail: "session_not_found" }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  }) as unknown as typeof fetch);
});

describe("Chọn phiên trong sidebar khôi phục lịch sử thật", () => {
  it("chọn phiên CŨ rồi chọn phiên MỚI: danh sách tin nhắn được thay thế đúng", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByText("Phiên cũ hơn"));
    expect(await screen.findByText("Câu trả lời CŨ")).toBeInTheDocument();
    expect(screen.queryByText("Câu trả lời MỚI")).not.toBeInTheDocument();

    await user.click(await screen.findByText("Phiên mới hơn"));
    await waitFor(() => expect(screen.getByText("Câu trả lời MỚI")).toBeInTheDocument());
    // Danh sách tin nhắn cũ phải bị THAY THẾ hoàn toàn, không cộng dồn.
    expect(screen.queryByText("Câu trả lời CŨ")).not.toBeInTheDocument();
  });

  it("chọn phiên đã mất (404) trên server: gỡ khỏi sidebar + hiện thông báo khôi phục tiếng Việt", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByText("Phiên đã mất"));

    await waitFor(() =>
      expect(screen.queryByText("Phiên đã mất")).not.toBeInTheDocument()
    );
    expect(
      await screen.findByText(/không còn tồn tại trên máy chủ/i)
    ).toBeInTheDocument();
  });
});
