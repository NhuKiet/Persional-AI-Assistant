import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { AppRoutes } from "../App";

function mockPdfUpload() {
  vi.stubGlobal("fetch", vi.fn(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/models")) {
      return new Response(JSON.stringify({ models: [], default: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/api/pdf/upload") && init?.method === "POST") {
      return new Response(JSON.stringify({
        filename: "doc.pdf",
        total_pages: 99,
        total_chars: 3400,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));
}

async function uploadPdf(container) {
  const input = container.querySelector('input[type="file"]');
  fireEvent.change(input, {
    target: { files: [new File(["pdf"], "doc.pdf", { type: "application/pdf" })] },
  });
  expect(await screen.findAllByText("doc.pdf")).not.toHaveLength(0);
}

test.each([
  ["/", /KiNg/i],
  ["/chat", /KiNg/i],
  ["/research", /Research/i],
  ["/coding", /Coding/i],
  ["/pdf", /PDF/i],
  ["/tool/homework", /Bài tập/i],
  ["/news", /Tin tức AI/i],
])("keeps public route %s renderable", async (path, expectedContent) => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );

  expect(await screen.findAllByText(expectedContent)).not.toHaveLength(0);
});

// Every route that renders a Sidebar previously let you close it (via the
// sidebar's own "Đóng sidebar" button) but had no way at all to reopen it —
// only HomePage happened to render its own separate reopen button. This
// locks in that every route now consistently offers a reopen control, that
// it works by both mouse and keyboard, and that it survives narrow-width
// (mobile overlay) layouts too.
describe.each([
  ["/chat", () => screen.findByText(/Hôm nay bạn cảm thấy thế nào/i)],
  ["/research", () => screen.findByPlaceholderText(/Nhập chủ đề nghiên cứu/i)],
  ["/coding", () => screen.findByPlaceholderText(/Mô tả task cần làm/i)],
  ["/pdf", () => screen.findByText(/Kéo thả file PDF vào đây/i)],
  ["/tool/homework", () => screen.findByPlaceholderText(/Bài tập…/i)],
])("sidebar reopen control on %s", (path, findAnchor) => {
  it("closes via mouse, then reopens via mouse", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>,
    );
    await findAnchor();

    await user.click(await screen.findByRole("button", { name: /Đóng sidebar/i }));
    const reopenBtn = await screen.findByRole("button", { name: /Mở sidebar/i });
    expect(reopenBtn).toBeInTheDocument();

    await user.click(reopenBtn);
    expect(await screen.findByRole("button", { name: /Đóng sidebar/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mở sidebar/i })).not.toBeInTheDocument();
  });

  it("reopens via keyboard (Enter on the focused reopen button)", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>,
    );
    await findAnchor();

    await user.click(await screen.findByRole("button", { name: /Đóng sidebar/i }));
    const reopenBtn = await screen.findByRole("button", { name: /Mở sidebar/i });
    reopenBtn.focus();
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("button", { name: /Đóng sidebar/i })).toBeInTheDocument();
  });

  it("keeps the same reopen control at narrow (mobile) viewport width", async () => {
    const originalWidth = window.innerWidth;
    act(() => {
      window.innerWidth = 375;
      window.dispatchEvent(new Event("resize"));
    });
    try {
      const user = userEvent.setup();
      render(
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>,
      );
      await findAnchor();

      await user.click(await screen.findByRole("button", { name: /Đóng sidebar/i }));
      const reopenBtn = await screen.findByRole("button", { name: /Mở sidebar/i });
      await user.click(reopenBtn);
      expect(await screen.findByRole("button", { name: /Đóng sidebar/i })).toBeInTheDocument();
    } finally {
      act(() => {
        window.innerWidth = originalWidth;
        window.dispatchEvent(new Event("resize"));
      });
    }
  });
});

describe.each([
  [1400, "desktop"],
  [375, "narrow"],
])("uploaded PDF workspace at %dpx (%s)", (width) => {
  it("renders the named workspace controls without a split divider and keeps AppShell reopenable", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    try {
      mockPdfUpload();
      const user = userEvent.setup();
      const { container } = render(
        <MemoryRouter initialEntries={["/pdf"]}>
          <AppRoutes />
        </MemoryRouter>,
      );

      await uploadPdf(container);

      expect(screen.getByRole("button", { name: /Mục lục/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Hỏi tài liệu|trợ lý tài liệu/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Tìm trong PDF" })).toBeInTheDocument();
      expect(container.querySelector(".pdf-divider")).not.toBeInTheDocument();

      const reopen = await screen.findByRole("button", { name: "Mở sidebar" });
      await user.click(reopen);
      expect(await screen.findByRole("button", { name: "Đóng sidebar" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Đóng sidebar" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Mở sidebar" })).toBeInTheDocument());
    } finally {
      act(() => {
        Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
        window.dispatchEvent(new Event("resize"));
      });
    }
  });
});
