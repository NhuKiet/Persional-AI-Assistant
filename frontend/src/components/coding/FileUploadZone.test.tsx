import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { FileUploadZone, type UploadedFile } from "./FileUploadZone";

const TABLE = {
  columns: [{ name: "city", type: "text" }, { name: "pop", type: "int" }],
  rows: [["Huế", 652572]],
  total_rows: 1,
  total_columns: 2,
};

function Harness({ initial = [] as UploadedFile[] }) {
  const [files, setFiles] = useState<UploadedFile[]>(initial);
  return (
    <FileUploadZone
      files={files}
      onAdd={(file) => setFiles((current) => [...current, file])}
      onRemove={(name) => setFiles((current) => current.filter((f) => f.name !== name))}
      sessionId="s1"
    />
  );
}

afterEach(() => vi.unstubAllGlobals());

it("opens the preview of a table right after it is uploaded", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(
    JSON.stringify({ name: "cities.csv", size: 40, preview: "city,pop", table: TABLE }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  )));
  const { container } = render(<Harness />);

  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [new File(["city,pop\nHuế,652572\n"], "cities.csv", { type: "text/csv" })] },
  });

  expect(await screen.findByRole("region", { name: "Xem trước cities.csv" })).toBeInTheDocument();
  expect(screen.getByText("Huế")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Ẩn cities.csv" })).toHaveAttribute("aria-expanded", "true");
});

it("toggles a preview and shows one at a time", async () => {
  render(<Harness initial={[
    { name: "a.csv", size: 10, table: TABLE },
    { name: "b.csv", size: 10, table: { ...TABLE, rows: [["Vinh", 339114]] } },
  ]} />);

  await userEvent.click(screen.getByRole("button", { name: "Xem trước a.csv" }));
  expect(screen.getByText("Huế")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Xem trước b.csv" }));
  expect(screen.queryByText("Huế")).toBeNull();
  expect(screen.getByText("Vinh")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Ẩn b.csv" }));
  await waitFor(() => expect(screen.queryByRole("region")).toBeNull());
});

it("offers no preview for a file that isn't a table", () => {
  render(<Harness initial={[{ name: "notes.txt", size: 10, table: null }]} />);

  expect(screen.queryByRole("button", { name: /Xem trước/ })).toBeNull();
});
