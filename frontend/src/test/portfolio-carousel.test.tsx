import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it } from "vitest";

import { PortfolioCarousel } from "../components/PortfolioCarousel";
import { PORTFOLIO_PAGES, type Lang } from "../config/portfolio";

// jsdom không có layout (mọi offsetLeft = 0) và không bắn scroll event, nên ở
// đây chỉ kiểm được phần trạng thái: nút/chấm/phím đổi thẻ đang xem. Chuyện
// trượt thật, hít thẻ và kéo chuột phải xem trên trình duyệt.

function Harness() {
  const [lang, setLang] = useState<Lang>("vi");
  return <PortfolioCarousel lang={lang} onLangChange={setLang} />;
}

const dot = (n: number) => screen.getByRole("button", { name: new RegExp(`^Thẻ ${n}:`) });

it("nút sau và chấm cuối đổi thẻ đang xem, khóa nút ở hai đầu", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const prev = screen.getByRole("button", { name: "Thẻ trước" });
  const next = screen.getByRole("button", { name: "Thẻ sau" });

  expect(prev).toBeDisabled();
  expect(dot(1)).toHaveAttribute("aria-current", "true");

  await user.click(next);
  expect(prev).toBeEnabled();
  expect(dot(2)).toHaveAttribute("aria-current", "true");
  expect(dot(1)).not.toHaveAttribute("aria-current");

  await user.click(dot(PORTFOLIO_PAGES.length));
  expect(next).toBeDisabled();
});

it("phím mũi tên trên carousel đổi thẻ, không vượt quá hai đầu", () => {
  render(<Harness />);
  const carousel = screen.getByRole("region", { name: "Portfolio của Kiệt" });

  fireEvent.keyDown(carousel, { key: "ArrowLeft" });
  expect(dot(1)).toHaveAttribute("aria-current", "true");

  fireEvent.keyDown(carousel, { key: "ArrowRight" });
  fireEvent.keyDown(carousel, { key: "ArrowRight" });
  expect(dot(3)).toHaveAttribute("aria-current", "true");
});

it("mỗi thẻ là một group có số thứ tự, và nút EN đổi cả nhãn lẫn nội dung", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const total = PORTFOLIO_PAGES.length;

  expect(screen.getByRole("group", { name: `1 trên ${total}` })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "EN" }));
  expect(screen.getByRole("group", { name: `1 of ${total}` })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next slide" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: PORTFOLIO_PAGES[0].title.en })).toBeInTheDocument();
});
