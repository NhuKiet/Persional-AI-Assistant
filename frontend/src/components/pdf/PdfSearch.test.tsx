import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import PdfSearch from "./PdfSearch";

it("shows the active result count and wraps navigation", async () => {
  const user = userEvent.setup();
  const onOpenResult = vi.fn();
  render(
    <PdfSearch
      pages={[{ page: 2, text: "Agent graph" }, { page: 7, text: "Agent memory" }]}
      onOpenResult={onOpenResult}
      onClose={vi.fn()}
    />,
  );

  await user.type(screen.getByRole("searchbox", { name: "Tìm trong PDF" }), "agent");

  expect(screen.getByText("1 / 2")).toBeInTheDocument();
  expect(onOpenResult).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));

  await user.click(screen.getByRole("button", { name: "Kết quả tiếp theo" }));
  expect(screen.getByText("2 / 2")).toBeInTheDocument();
  expect(onOpenResult).toHaveBeenLastCalledWith(expect.objectContaining({ page: 7 }));

  await user.click(screen.getByRole("button", { name: "Kết quả tiếp theo" }));
  expect(screen.getByText("1 / 2")).toBeInTheDocument();
});

it("reports truthfully when a PDF has no searchable text", () => {
  render(<PdfSearch pages={[]} onOpenResult={vi.fn()} onClose={vi.fn()} />);

  expect(screen.getByText("Không có văn bản để tìm kiếm")).toBeInTheDocument();
});

it("provides accessible controls for closing and unsuccessful queries", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<PdfSearch pages={[{ page: 1, text: "Embeddings" }]} onOpenResult={vi.fn()} onClose={onClose} />);

  await user.type(screen.getByRole("searchbox", { name: "Tìm trong PDF" }), "vector");
  expect(screen.getByText("Không tìm thấy kết quả")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Đóng tìm kiếm" }));
  expect(onClose).toHaveBeenCalledOnce();
});
