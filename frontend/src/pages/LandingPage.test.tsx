import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import { LandingPage } from "./LandingPage";

function renderLanding() {
  const view = render(<MemoryRouter><LandingPage /></MemoryRouter>);
  const scroller = view.container.querySelector<HTMLElement>(".atom-landing")!;
  const status = screen.getByText(/Lõi xử lý trực tuyến/).closest(".atom-status")!;
  const scrollTo = (top: number) => {
    scroller.scrollTop = top;
    fireEvent.scroll(scroller);
  };
  return { status, scrollTo };
}

// Thanh trên cùng dính khi cuộn; viên trạng thái chỉ để trang trí, nổi đè lên
// nội dung thì chỉ thêm rối — ẩn đi, còn logo và nút "Mở trợ lý" ở lại.
it("hides the status pill once the page is scrolled, and brings it back at the top", () => {
  const { status, scrollTo } = renderLanding();
  expect(status).not.toHaveAttribute("aria-hidden");

  scrollTo(300);
  expect(status).toHaveAttribute("aria-hidden", "true");
  expect(screen.getByRole("link", { name: /Mở trợ lý/ })).toBeVisible();

  scrollTo(0);
  expect(status).not.toHaveAttribute("aria-hidden");
});
