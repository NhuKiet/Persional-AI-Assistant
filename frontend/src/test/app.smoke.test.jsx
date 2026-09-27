/**
 * Smoke test — lưới an toàn cho việc tách App.jsx.
 *
 * Cố ý đi qua <App /> và chỉ khẳng định những gì NGƯỜI DÙNG thấy, không chạm
 * vào cấu trúc nội bộ. Nhờ vậy test sống sót qua refactor: nếu tách file làm
 * vỡ một page, test đỏ; nếu chỉ dời code, test vẫn xanh.
 */
import { StrictMode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App.tsx";
import { FEATURES } from "../config/features";
import { TOOLS, VISIBLE_TOOLS, toolPath } from "../config/tools";

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

// Một số tool đang bị ẩn tạm khỏi dock (cờ `hidden` trong config/tools.ts).
// Các khẳng định về dock ĐỌC TỪ CONFIG chứ không chép cứng danh sách: bật lại
// một tool chỉ cần xoá `hidden: true`, không phải sửa kèm test ở đây.
const HIDDEN_TOOLS = TOOLS.filter(t => t.hidden);

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
// CHỈ dùng được cho tool còn hiện trong dock; tool đang ẩn thì đi openToolUrl.
async function openTool(titleRe) {
  const user = userEvent.setup();
  window.history.pushState({}, "", "/chat");
  render(<App />);
  await user.click(await screen.findByTitle(titleRe));
  return user;
}

// Tool bị ẩn khỏi dock vẫn phải CHẠY được khi vào thẳng URL — ẩn là bỏ lối vào
// trong UI, không phải tắt tính năng. Vào bằng URL để vẫn giữ được lưới an toàn
// cho những page đó thay vì xoá test đi.
function openToolUrl(path) {
  const user = userEvent.setup();
  window.history.pushState({}, "", path);
  render(<App />);
  return user;
}

// Các smoke test dưới đây khẳng định landing ĐÃ render, không khẳng định nó
// nói câu gì. Trước đây chúng khớp chính xác chuỗi "hội tụ thành trợ lý";
// bản redesign landing đổi headline và cả năm test đỏ cùng lúc, dù ứng dụng
// vẫn chạy đúng. Một smoke test gắn vào câu chữ marketing sẽ hỏng mỗi lần
// marketing đổi ý, nên ở đây kiểm h1 theo role thay vì theo nội dung.
describe("Trang chủ (\"/\") — landing, không phải chat", () => {
  // Ba lối vào phần chính: nút "Mở trợ lý" trên thanh trên cùng (luôn thấy,
  // kể cả trên điện thoại khi thẻ trợ lý nằm dưới portfolio), ô hỏi nhanh
  // trong thẻ trợ lý, và lối tắt thẳng vào từng công cụ đang bật.
  it("hiện headline và nút vào trợ lý trên thanh trên cùng", async () => {
    render(<App />);
    const nav = await screen.findByRole("navigation", { name: "Điều hướng chính" });
    expect(within(nav).getByRole("link", { name: /Mở trợ lý/i })).toHaveAttribute("href", "/chat");
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("bấm nút trên thanh điều hướng sang /chat", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: /Mở trợ lý/i }));
    expect(await screen.findByPlaceholderText(/Hỏi KiNg bất cứ điều gì/i)).toBeInTheDocument();
    expect(window.location.pathname).toBe("/chat");
  });

  // StrictMode chạy effect hai lần khi mount (như `npm run dev`): câu hỏi
  // mang từ trang chủ sang vẫn chỉ được gửi một lần.
  it("hỏi nhanh ở trang chủ: sang /chat và gửi đúng câu đó, một lần", async () => {
    const user = userEvent.setup();
    render(<StrictMode><App /></StrictMode>);

    await user.type(await screen.findByRole("textbox", { name: "Hỏi KiNg" }), "RAG là gì?{Enter}");

    const streams = () => globalThis.fetch.mock.calls.filter(([u]) => String(u).includes("/api/chat/stream"));
    await waitFor(() => expect(streams()).not.toHaveLength(0));
    expect(window.location.pathname).toBe("/chat");
    expect(streams()).toHaveLength(1);
    expect(JSON.parse(streams()[0][1].body)).toMatchObject({ message: "RAG là gì?" });
  });

  it("ô hỏi nhanh để trống thì chỉ mở trợ lý", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Gửi câu hỏi cho KiNg" }));
    expect(window.location.pathname).toBe("/chat");
    expect(globalThis.fetch.mock.calls.some(([u]) => String(u).includes("/api/chat/stream"))).toBe(false);
  });

  it("phím / đưa con trỏ vào ô hỏi nhanh", async () => {
    const user = userEvent.setup();
    render(<App />);
    const ask = await screen.findByRole("textbox", { name: "Hỏi KiNg" });

    await user.keyboard("/");

    expect(ask).toHaveFocus();
    expect(ask).toHaveValue("");
  });

  it("có lối tắt vào thẳng đúng các công cụ đang bật", async () => {
    render(<App />);
    const shortcuts = await screen.findByRole("navigation", { name: "Vào thẳng công cụ" });
    const hrefs = within(shortcuts).getAllByRole("link").map(a => a.getAttribute("href"));
    const expected = VISIBLE_TOOLS.map(toolPath).concat(FEATURES.news ? ["/news"] : []);
    expect(hrefs).toEqual(expected);
  });

  it("bấm lối tắt Research mở thẳng trang Research", async () => {
    const user = userEvent.setup();
    render(<App />);
    const shortcuts = await screen.findByRole("navigation", { name: "Vào thẳng công cụ" });
    await user.click(within(shortcuts).getByRole("link", { name: /Nghiên cứu/i }));
    expect(await screen.findByPlaceholderText(/Nhập chủ đề nghiên cứu/i)).toBeInTheDocument();
  });
});

describe("Trang chat (/chat)", () => {
  beforeEach(() => window.history.pushState({}, "", "/chat"));

  it("hiện ô chat và dock đúng các tool đang bật", async () => {
    render(<App />);
    expect(await screen.findByPlaceholderText(/Hỏi KiNg bất cứ điều gì/i)).toBeInTheDocument();
    for (const tool of VISIBLE_TOOLS) {
      expect(screen.getByTitle(tool.desc)).toBeInTheDocument();
    }
  });

  it("KHÔNG hiện tool đang ẩn trong dock", async () => {
    render(<App />);
    await screen.findByPlaceholderText(/Hỏi KiNg bất cứ điều gì/i);
    for (const tool of HIDDEN_TOOLS) {
      expect(screen.queryByTitle(tool.desc)).not.toBeInTheDocument();
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

  // Coding đang ẩn khỏi dock nên vào thẳng /coding; page vẫn phải render đúng.
  it("mở Coding (đang ẩn khỏi dock — vào thẳng URL)", async () => {
    openToolUrl("/coding");
    expect(await screen.findByText(/Coding Agent/i)).toBeInTheDocument();
  });

  it("mở PDF Chat và thấy upload zone", async () => {
    await openTool(TOOL_TITLE.pdf);
    expect(await screen.findByText(/Kéo thả file PDF vào đây/i)).toBeInTheDocument();
  });

  it("mở ToolPage (Bài tập — đang ẩn khỏi dock, vào thẳng URL)", async () => {
    openToolUrl("/tool/homework");
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
    const user = openToolUrl("/tool/homework");
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
