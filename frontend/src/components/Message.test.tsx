import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { preloadMarkdown } from "./Markdown";
import { Message } from "./Message";
import type { ChatMessage } from "../types";

beforeAll(async () => { await preloadMarkdown(); });

const ai = (content: string): ChatMessage => ({ role: "assistant", content, id: 2 });
const user = (content: string): ChatMessage => ({ role: "user", content, id: 1 });

describe("Message — assistant actions", () => {
  it("copies the raw markdown of an answer", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<Message msg={ai("**Đậm** và `code`")} accentColor="red" />);

    await userEvent.click(screen.getByRole("button", { name: "Chép" }));

    expect(writeText).toHaveBeenCalledWith("**Đậm** và `code`");
  });

  it("has nothing to copy while the first token is still coming", () => {
    render(<Message msg={ai("")} accentColor="red" />);
    expect(screen.queryByRole("button", { name: "Chép" })).toBeNull();
  });

  it("offers Tạo lại only when the page allows it, and not while streaming", () => {
    const onRegenerate = vi.fn();
    const { rerender } = render(<Message msg={ai("x")} accentColor="red" onRegenerate={onRegenerate} />);

    fireEvent.click(screen.getByRole("button", { name: "Tạo lại" }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);

    rerender(<Message msg={ai("x")} accentColor="red" onRegenerate={onRegenerate} busy />);
    expect(screen.queryByRole("button", { name: "Tạo lại" })).toBeNull();

    rerender(<Message msg={ai("x")} accentColor="red" />);
    expect(screen.queryByRole("button", { name: "Tạo lại" })).toBeNull();
  });
});

describe("Message — editing the last question", () => {
  it("edits in place and sends the new text", () => {
    const onEdit = vi.fn();
    render(<Message msg={user("Thủ đô Úc?")} accentColor="red" onEdit={onEdit} />);

    fireEvent.click(screen.getByRole("button", { name: "Sửa" }));
    const box = screen.getByRole("textbox", { name: /Sửa câu hỏi/ });
    expect(box).toHaveValue("Thủ đô Úc?");
    fireEvent.change(box, { target: { value: "Thủ đô Canada?" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi lại" }));

    expect(onEdit).toHaveBeenCalledWith("Thủ đô Canada?");
    expect(screen.queryByRole("textbox", { name: /Sửa câu hỏi/ })).toBeNull();
  });

  it("sends with Enter and cancels with Escape", () => {
    const onEdit = vi.fn();
    render(<Message msg={user("a")} accentColor="red" onEdit={onEdit} />);

    fireEvent.click(screen.getByRole("button", { name: "Sửa" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: /Sửa câu hỏi/ }), { key: "Escape" });
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(onEdit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Sửa" }));
    const box = screen.getByRole("textbox", { name: /Sửa câu hỏi/ });
    fireEvent.change(box, { target: { value: "b" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onEdit).toHaveBeenCalledWith("b");
  });

  it("does not send an empty or unchanged question", () => {
    const onEdit = vi.fn();
    render(<Message msg={user("a")} accentColor="red" onEdit={onEdit} />);
    fireEvent.click(screen.getByRole("button", { name: "Sửa" }));
    const box = screen.getByRole("textbox", { name: /Sửa câu hỏi/ });

    expect(screen.getByRole("button", { name: "Gửi lại" })).toBeDisabled();
    fireEvent.change(box, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Gửi lại" })).toBeDisabled();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("shows no Sửa button without onEdit or while streaming", () => {
    const { rerender } = render(<Message msg={user("a")} accentColor="red" />);
    expect(screen.queryByRole("button", { name: "Sửa" })).toBeNull();

    rerender(<Message msg={user("a")} accentColor="red" onEdit={vi.fn()} busy />);
    expect(screen.queryByRole("button", { name: "Sửa" })).toBeNull();
  });
});
