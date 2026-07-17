/**
 * Smoke test — lưới an toàn cho việc tách App.jsx.
 *
 * Cố ý đi qua <App /> và chỉ khẳng định những gì NGƯỜI DÙNG thấy, không chạm
 * vào cấu trúc nội bộ. Nhờ vậy test sống sót qua refactor: nếu tách file làm
 * vỡ một page, test đỏ; nếu chỉ dời code, test vẫn xanh.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App.tsx";

const MODELS = {
  models: [{ provider: "ollama", model: "llama3", label: "llama3 (local)" }],
  default: { provider: "ollama", model: "llama3" },
};

// Mỗi tool có `title` = desc riêng biệt => neo ổn định, không trùng như label.
const TOOL_TITLE = {
  research: /Deep research/i,
  coding: /AI coding agent/i,
  homework: /Giải toán, lý, hóa/i,
  pdf: /Chat với tài liệu PDF/i,
};

beforeEach(() => {
  // BrowserRouter đọc history thật của jsdom, và history sống xuyên suốt file
  // test => test trước điều hướng đi đâu thì test sau khởi động ở đó. Reset về "/".
  window.history.pushState({}, "", "/");

  vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
    const u = String(url);
    const json = u.includes("/api/models") ? MODELS
      : u.includes("/api/pdf/list") ? { files: [] }
      : {};
    return Promise.resolve({ ok: true, json: () => Promise.resolve(json) });
  });
});

// ToolDock (trang chat) và bảng công cụ trên LandingPage đều đứng sau route
// riêng /chat và "/" — mở tool luôn đi qua /chat cho nhất quán với hành vi cũ.
async function openTool(titleRe) {
  const user = userEvent.setup();
  window.history.pushState({}, "", "/chat");
  render(<App />);
  await user.click(await screen.findByTitle(titleRe));
  return user;
}

describe("Trang chủ (\"/\") — landing, không phải chat", () => {
  it("hiện thesis, CTA và đủ 6 thẻ công cụ", async () => {
    render(<App />);
    expect(await screen.findByRole("button", { name: /Mở trợ lý/i })).toBeInTheDocument();
    expect(await screen.findByText(/Một chỗ làm việc/i)).toBeInTheDocument();
    for (const re of Object.values(TOOL_TITLE)) {
      expect(screen.getByTitle(re)).toBeInTheDocument();
    }
  });

  it("bấm CTA điều hướng sang /chat", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /Mở trợ lý/i }));
    expect(await screen.findByPlaceholderText(/Hỏi KiNg bất cứ điều gì/i)).toBeInTheDocument();
    expect(window.location.pathname).toBe("/chat");
  });

  it("bấm thẻ Research đi thẳng /research, không qua /chat", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByTitle(TOOL_TITLE.research));
    expect(await screen.findByPlaceholderText(/Nhập chủ đề nghiên cứu/i)).toBeInTheDocument();
    expect(window.location.pathname).toBe("/research");
  });

  it("gõ câu hỏi ở ô nhập trang chủ rồi Enter: sang /chat và gửi luôn câu đó", async () => {
    const user = userEvent.setup();
    render(<App />);
    const input = await screen.findByPlaceholderText(/Hỏi KiNg bất cứ điều gì/i);
    await user.type(input, "Giải thích transformer{Enter}");
    expect(window.location.pathname).toBe("/chat");
    // Cụm này lặp lại 2 lần hợp lệ: bong bóng chat + tiêu đề session mới
    // trong sidebar (addSession chạy trên tin đầu tiên) — khoanh vùng vào
    // đúng bong bóng để không vỡ khi có lần lặp thứ hai hợp lệ.
    const bubble = await screen.findByText("Giải thích transformer", { selector: ".bubble-user" });
    expect(bubble).toBeInTheDocument();
  });
});

describe("Trang chat (/chat)", () => {
  beforeEach(() => window.history.pushState({}, "", "/chat"));

  it("hiện ô chat và dock đủ 6 tool", async () => {
    render(<App />);
    expect(await screen.findByPlaceholderText(/Hỏi KiNg bất cứ điều gì/i)).toBeInTheDocument();
    for (const re of Object.values(TOOL_TITLE)) {
      expect(screen.getByTitle(re)).toBeInTheDocument();
    }
  });

  it("nạp model khả dụng vào ModelPicker từ /api/models", async () => {
    render(<App />);
    expect(await screen.findByRole("combobox")).toBeInTheDocument();
    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining("/api/models")),
    );
  });

  it("có nút Trang chủ trong sidebar để quay về landing", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /Trang chủ/i }));
    expect(await screen.findByText(/Một chỗ làm việc/i)).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });
});

describe("điều hướng sang từng tool", () => {
  it("mở Research", async () => {
    await openTool(TOOL_TITLE.research);
    expect(await screen.findByPlaceholderText(/Nhập chủ đề nghiên cứu/i)).toBeInTheDocument();
  });

  it("mở Coding", async () => {
    await openTool(TOOL_TITLE.coding);
    expect(await screen.findByText(/Coding Agent/i)).toBeInTheDocument();
  });

  it("mở PDF Chat và thấy upload zone", async () => {
    await openTool(TOOL_TITLE.pdf);
    expect(await screen.findByText(/Kéo thả file PDF vào đây/i)).toBeInTheDocument();
  });

  it("mở ToolPage (Bài tập)", async () => {
    await openTool(TOOL_TITLE.homework);
    // ToolPage đặt placeholder động theo tool: `${tool.label}…`
    expect(await screen.findByPlaceholderText(/Bài tập/i)).toBeInTheDocument();
    expect(screen.getByText(/Thử ngay/i)).toBeInTheDocument();
  });

  it("quay lại trang chủ từ một tool có route riêng (Research)", async () => {
    const user = await openTool(TOOL_TITLE.research);
    await user.click(await screen.findByRole("button", { name: /KiNg/i }));
    expect(await screen.findByText(/Một chỗ làm việc/i)).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });

  // ToolRoute (/tool/:toolId, ví dụ "Bài tập") tự định nghĩa onBack riêng,
  // KHÔNG đi qua withBack() như Research/Coding/Pdf — dễ sửa một chỗ mà quên
  // chỗ kia. Test riêng để bắt đúng lỗi đó nếu nó tái diễn.
  it("quay lại trang chủ từ một tool dùng route chung (/tool/:id)", async () => {
    const user = await openTool(TOOL_TITLE.homework);
    await user.click(await screen.findByRole("button", { name: /KiNg/i }));
    expect(await screen.findByText(/Một chỗ làm việc/i)).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });
});

describe("routing — mỗi tool có URL riêng nên F5 không rơi về home", () => {
  it("mở thẳng /research (như khi F5) vẫn ra đúng trang", async () => {
    window.history.pushState({}, "", "/research");
    render(<App />);
    expect(await screen.findByPlaceholderText(/Nhập chủ đề nghiên cứu/i)).toBeInTheDocument();
  });

  it("mở thẳng /pdf (như khi F5) vẫn ra đúng trang", async () => {
    window.history.pushState({}, "", "/pdf");
    render(<App />);
    expect(await screen.findByText(/Kéo thả file PDF vào đây/i)).toBeInTheDocument();
  });

  it("mở thẳng /tool/homework vẫn ra đúng trang", async () => {
    window.history.pushState({}, "", "/tool/homework");
    render(<App />);
    expect(await screen.findByPlaceholderText(/Bài tập/i)).toBeInTheDocument();
  });

  it("chọn tool thì URL đổi theo", async () => {
    await openTool(TOOL_TITLE.pdf);
    expect(window.location.pathname).toBe("/pdf");
  });

  it("URL lạ thì đưa về home", async () => {
    window.history.pushState({}, "", "/khong-ton-tai");
    render(<App />);
    expect(await screen.findByTitle(TOOL_TITLE.research)).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });
});
