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

it.each([
  { pages: [] },
  { pages: [{ page: 1, text: " \n\t " }] },
])("reports truthfully when a PDF has no searchable text", ({ pages }) => {
  render(<PdfSearch pages={pages} onOpenResult={vi.fn()} onClose={vi.fn()} />);

  expect(screen.getByText("Không có văn bản để tìm kiếm")).toBeInTheDocument();
  expect(screen.getByRole("searchbox", { name: "Tìm trong PDF" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Kết quả trước đó" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Kết quả tiếp theo" })).toBeDisabled();
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

it("does not announce no results for a whitespace-only query", async () => {
  const user = userEvent.setup();
  render(<PdfSearch pages={[{ page: 1, text: "Embeddings" }]} onOpenResult={vi.fn()} onClose={vi.fn()} />);

  await user.type(screen.getByRole("searchbox", { name: "Tìm trong PDF" }), "   ");

  expect(screen.queryByText("Không tìm thấy kết quả")).not.toBeInTheDocument();
});

it("clamps the active result before callbacks when replacement pages shrink results", async () => {
  const user = userEvent.setup();
  const onOpenResult = vi.fn();
  const onClose = vi.fn();
  const { rerender } = render(
    <PdfSearch
      pages={[{ page: 2, text: "Agent graph" }, { page: 7, text: "Agent memory" }]}
      onOpenResult={onOpenResult}
      onClose={onClose}
    />,
  );

  await user.type(screen.getByRole("searchbox", { name: "Tìm trong PDF" }), "agent");
  await user.click(screen.getByRole("button", { name: "Kết quả tiếp theo" }));
  expect(onOpenResult).toHaveBeenLastCalledWith(expect.objectContaining({ page: 7 }));

  rerender(
    <PdfSearch
      pages={[{ page: 9, text: "Agent only" }]}
      onOpenResult={onOpenResult}
      onClose={onClose}
    />,
  );

  expect(onOpenResult).not.toHaveBeenCalledWith(undefined);
  expect(onOpenResult).toHaveBeenLastCalledWith(expect.objectContaining({ page: 9 }));
});
