import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "../App";

test.each([
  ["/", /KiNg/i],
  ["/chat", /KiNg/i],
  ["/research", /Research/i],
  ["/coding", /Coding/i],
  ["/pdf", /PDF/i],
  ["/tool/homework", /Bài tập/i],
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
    window.innerWidth = 375;
    window.dispatchEvent(new Event("resize"));
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
      window.innerWidth = originalWidth;
      window.dispatchEvent(new Event("resize"));
    }
  });
});
