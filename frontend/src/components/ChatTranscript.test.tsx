import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ChatTranscript } from "./ChatTranscript";
import { preloadMarkdown } from "./Markdown";
import type { ChatMessage } from "../types";

beforeAll(async () => { await preloadMarkdown(); });

const CONVERSATION: ChatMessage[] = [
  { role: "user", content: "Q1", id: 1 },
  { role: "assistant", content: "A1", id: 2 },
  { role: "user", content: "Q2", id: 3 },
  { role: "assistant", content: "A2", id: 4 },
];

function renderTranscript(props: Partial<Parameters<typeof ChatTranscript>[0]> = {}) {
  const onRegenerate = vi.fn();
  const onEdit = vi.fn();
  render(
    <ChatTranscript
      messages={CONVERSATION}
      streaming={false}
      accentColor="red"
      onRegenerate={onRegenerate}
      onEdit={onEdit}
      {...props}
    />,
  );
  return { onRegenerate, onEdit };
}

describe("ChatTranscript", () => {
  it("offers Tạo lại on the latest answer and Sửa on the latest question only", () => {
    renderTranscript();

    expect(screen.getAllByRole("button", { name: "Tạo lại" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Sửa" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Chép" })).toHaveLength(2);
  });

  it("wires the actions to the latest turn", () => {
    const { onRegenerate, onEdit } = renderTranscript();

    fireEvent.click(screen.getByRole("button", { name: "Tạo lại" }));
    fireEvent.click(screen.getByRole("button", { name: "Sửa" }));
    expect(screen.getByRole("textbox", { name: /Sửa câu hỏi/ })).toHaveValue("Q2");
    fireEvent.change(screen.getByRole("textbox", { name: /Sửa câu hỏi/ }), { target: { value: "Q2 mới" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi lại" }));

    expect(onRegenerate).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith("Q2 mới");
  });

  it("hides both while a reply is streaming", () => {
    renderTranscript({ streaming: true });

    expect(screen.queryByRole("button", { name: "Tạo lại" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sửa" })).toBeNull();
  });

  it("offers no Tạo lại when the last message is a question still waiting", () => {
    renderTranscript({ messages: CONVERSATION.slice(0, 3) });

    expect(screen.queryByRole("button", { name: "Tạo lại" })).toBeNull();
  });

  it("renders what goes before the messages", () => {
    renderTranscript({ messages: [], before: <p>Thử ngay</p> });

    expect(screen.getByText("Thử ngay")).toBeInTheDocument();
  });
});
