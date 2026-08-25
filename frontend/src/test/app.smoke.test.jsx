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

// Các smoke test dưới đây khẳng định landing ĐÃ render, không khẳng định nó
// nói câu gì. Trước đây chúng khớp chính xác chuỗi "hội tụ thành trợ lý";
// bản redesign landing đổi headline và cả năm test đỏ cùng lúc, dù ứng dụng
// vẫn chạy đúng. Một smoke test gắn vào câu chữ marketing sẽ hỏng mỗi lần
// marketing đổi ý, nên ở đây kiểm h1 theo role thay vì theo nội dung.
describe("Trang chủ (\"/\") — landing, không phải chat", () => {
  // Landing giờ là hero "Capability Reactor" (canvas 3D + nav); không còn ô
  // nhập chat hay bảng 6 công cụ trực tiếp trên "/" — lối vào duy nhất là CTA
  // "Mở trợ lý" dẫn sang /chat, nơi vẫn còn đủ 6 tool qua ToolDock (xem describe
  // "điều hướng sang từng tool" bên dưới, đi qua /chat trước).
  it("hiện headline và CTA vào trợ lý", async () => {
    render(<App />);
    expect(await screen.findByRole("button", { name: /Mở trợ lý/i })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("bấm CTA điều hướng sang /chat", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /Mở trợ lý/i }));
    expect(await screen.findByPlaceholderText(/Hỏi KiNg bất cứ điều gì/i)).toBeInTheDocument();
    expect(window.location.pathname).toBe("/chat");
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
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
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
    await user.click(await screen.findByRole("button", { name: /Trang chủ/i }));
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });

  // Không còn back-btn riêng trên header tool nào — nút "Trang chủ" trong
  // sidebar là đường về nhà duy nhất, dùng chung cho mọi route. Test riêng
  // để bắt lỗi nếu route /tool/:toolId (ví dụ "Bài tập") lỡ thiếu sidebar.
  it("quay lại trang chủ từ một tool dùng route chung (/tool/:id)", async () => {
    const user = await openTool(TOOL_TITLE.homework);
    await user.click(await screen.findByRole("button", { name: /Trang chủ/i }));
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
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
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });
});
