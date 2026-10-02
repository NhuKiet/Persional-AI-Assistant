import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { LandingPage } from "./LandingPage";

// The 3D scene (three.js) is a lazy chunk: stand in for it to see when it is
// built and torn down.
const compass = vi.hoisted(() => ({ create: vi.fn(), dispose: vi.fn() }));
vi.mock("../three/compass", () => ({
  createCompass: (...args: unknown[]) => {
    compass.create(...args);
    return { setBackgroundColor: vi.fn(), dispose: compass.dispose };
  },
}));

it("shows the calendar at once and builds the 3D scene after, then disposes it on leave", async () => {
  compass.create.mockClear();
  compass.dispose.mockClear();
  const view = render(<MemoryRouter><LandingPage /></MemoryRouter>);

  expect(screen.getByRole("region", { name: "Lịch thiên văn hôm nay" })).toHaveTextContent("°");
  await waitFor(() => expect(compass.create).toHaveBeenCalledTimes(1));

  view.unmount();
  expect(compass.dispose).toHaveBeenCalledTimes(1);
});

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
