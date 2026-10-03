import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { OutputPanel } from "./OutputPanel";

const ran = { type: "output", stdout: "(6, 2)\n", stderr: "", exit_code: 0, timed_out: false, duration: 1.2 };

it("lists the variables kept for the next request, described on demand", async () => {
  render(<OutputPanel output={{ ...ran, kept_variables: [
    { name: "df", summary: "DataFrame 6x2, columns: thang, doanh_thu" },
    { name: "total", summary: "int = 935" },
  ] }} />);

  const kept = screen.getByText(/Giữ cho câu hỏi sau/);
  expect(kept).toHaveTextContent("df, total");
  await userEvent.click(kept);
  expect(screen.getByText("DataFrame 6x2, columns: thang, doanh_thu")).toBeVisible();
});

it("says nothing about kept variables when there are none", () => {
  render(<OutputPanel output={{ ...ran, kept_variables: [] }} />);

  expect(screen.queryByText(/Giữ cho câu hỏi sau/)).not.toBeInTheDocument();
});
