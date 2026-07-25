import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import PdfAssistantPanel from "./PdfAssistantPanel";

function panelProps(): ComponentProps<typeof PdfAssistantPanel> {
  return {
    filename: "doc.pdf",
    totalPages: 12,
    totalChars: 3400,
    messages: [],
    pins: [],
    input: "",
    streaming: false,
    summarizing: false,
    accentColor: "#FF8C69",
    onInputChange: vi.fn(),
    onSend: vi.fn(),
    onSummarize: vi.fn(),
    onRemovePin: vi.fn(),
    onOpenSource: vi.fn(),
  };
}

it("preserves file information, summary, messages, pins, and input", () => {
  render(<PdfAssistantPanel {...panelProps()} />);

  expect(screen.getByText("doc.pdf")).toBeInTheDocument();
  expect(screen.getByText("12 trang · 3.4K ký tự")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Tóm tắt" })).toBeInTheDocument();
  expect(screen.getByPlaceholderText("Hỏi về nội dung PDF…")).toBeInTheDocument();
});

it("keeps Enter-to-send while allowing Shift+Enter", async () => {
  const props = panelProps();
  props.input = "Câu hỏi";
  render(<PdfAssistantPanel {...props} />);
  const input = screen.getByPlaceholderText("Hỏi về nội dung PDF…");

  await userEvent.type(input, "{Shift>}{Enter}{/Shift}");
  expect(props.onSend).not.toHaveBeenCalled();

  await userEvent.type(input, "{Enter}");
  expect(props.onSend).toHaveBeenCalledWith("Câu hỏi");
});

it("renders assistant sources and removable context pins", async () => {
  const props = panelProps();
  const source = { page: 4, chunk_index: 2, excerpt: "Đoạn nguồn" };
  props.messages = [{
    role: "assistant" as const,
    content: "Câu trả lời",
    id: 9,
    sources: [source],
  }];
  props.pins = [{ type: "text" as const, page: 3, text: "Đoạn đã ghim" }];
  render(<PdfAssistantPanel {...props} />);

  await userEvent.click(screen.getByRole("button", { name: "Trang 4" }));
  expect(props.onOpenSource).toHaveBeenCalledWith(source);

  await userEvent.click(screen.getByRole("button", { name: "Bỏ ghim trang 3" }));
  expect(props.onRemovePin).toHaveBeenCalledWith(0);
});
