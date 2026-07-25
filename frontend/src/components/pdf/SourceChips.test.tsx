import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import SourceChips from "./SourceChips";

it("labels sources by display order and opens the selected source", async () => {
  const onOpenSource = vi.fn();
  const source = { page: 15, chunk_index: 7, excerpt: "Embeddings" };
  render(<SourceChips sources={[source]} onOpenSource={onOpenSource} />);

  await userEvent.click(screen.getByRole("button", { name: "Trang 15" }));

  expect(onOpenSource).toHaveBeenCalledWith(source);
});
