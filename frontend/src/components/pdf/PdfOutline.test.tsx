import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import PdfOutline from "./PdfOutline";

it("navigates using the resolved outline", async () => {
  const onNavigate = vi.fn();
  render(
    <PdfOutline
      items={[{ title: "Chương", page: 5, children: [] }]}
      totalPages={8}
      currentPage={5}
      onNavigate={onNavigate}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: "Chương" }));

  expect(onNavigate).toHaveBeenCalledWith(5);
  expect(screen.getByRole("button", { name: "Chương" })).toHaveAttribute("aria-current", "page");
});

it("marks the nearest nested destination at or before the current page", () => {
  render(
    <PdfOutline
      items={[{
        title: "Chương",
        page: 2,
        children: [{ title: "Mục", page: 6, children: [] }],
      }]}
      totalPages={8}
      currentPage={4}
      onNavigate={vi.fn()}
    />,
  );

  expect(screen.getByRole("button", { name: "Chương" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("button", { name: "Mục" })).not.toHaveAttribute("aria-current");
  expect(screen.getAllByRole("list")).toHaveLength(2);
});

it("renders a flat page list when no outline exists", () => {
  render(<PdfOutline items={[]} totalPages={3} currentPage={1} onNavigate={vi.fn()} />);

  expect(screen.getByRole("button", { name: "Trang 3" })).toBeInTheDocument();
});
