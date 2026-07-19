import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import PdfMessage from "./PdfMessage";

it("shows source chips only for assistant messages", () => {
  render(
    <PdfMessage
      message={{
        role: "user",
        content: "Câu hỏi",
        id: 9,
        sources: [{ page: 15, chunk_index: 7, excerpt: "Embeddings" }],
      }}
      accentColor="#FF8C69"
      onOpenSource={vi.fn()}
    />,
  );

  expect(screen.queryByRole("button", { name: "Trang 15 · Nguồn 1" })).not.toBeInTheDocument();
});
