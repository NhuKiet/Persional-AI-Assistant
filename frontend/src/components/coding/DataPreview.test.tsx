import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { DataPreview, type DataTable } from "./DataPreview";

const TABLE: DataTable = {
  columns: [
    { name: "id", type: "int" },
    { name: "name", type: "text" },
    { name: "score", type: "float" },
  ],
  rows: [
    ["1", "An", "8.5"],
    ["2", "Bình", null],
  ],
  total_rows: 1204,
  total_columns: 3,
};

it("shows column names with their types, the first rows and the totals", () => {
  render(<DataPreview table={TABLE} name="grades.csv" />);

  expect(screen.getByText("1.204 dòng × 3 cột")).toBeInTheDocument();
  const headers = screen.getAllByRole("columnheader").map((th) => th.textContent);
  expect(headers).toEqual(["idint", "nametext", "scorefloat"]);
  const [, first, second] = screen.getAllByRole("row");
  expect(within(first).getAllByRole("cell").map((td) => td.textContent)).toEqual(["1", "An", "8.5"]);
  expect(within(second).getByLabelText("trống")).toBeInTheDocument();
  expect(screen.getByText("… và 1.202 dòng nữa")).toBeInTheDocument();
});

it("right-aligns numeric columns", () => {
  render(<DataPreview table={TABLE} name="grades.csv" />);

  const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
  expect(cells[0]).toHaveClass("is-num");
  expect(cells[1]).not.toHaveClass("is-num");
});

it("says when only the first columns are shown, and which sheet", () => {
  render(<DataPreview table={{ ...TABLE, total_columns: 45, sheet: "Doanh thu (1/2 sheet)" }} name="book.xlsx" />);

  expect(screen.getByText("1.204 dòng × 45 cột · Doanh thu (1/2 sheet) · hiện 3 cột đầu")).toBeInTheDocument();
});

it("has no 'more rows' line when every row is shown", () => {
  render(<DataPreview table={{ ...TABLE, total_rows: 2 }} name="small.csv" />);

  expect(screen.queryByText(/dòng nữa/)).toBeNull();
});
