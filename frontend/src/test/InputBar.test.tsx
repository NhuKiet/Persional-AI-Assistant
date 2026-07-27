import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { InputBar } from "../components/InputBar";

it("gửi text khi bấm nút gửi", async () => {
  const onSend = vi.fn();
  const user = userEvent.setup();
  render(<InputBar onSend={onSend} streaming={false} onStop={() => {}} placeholder="Nhắn…" />);
  await user.type(screen.getByPlaceholderText("Nhắn…"), "xin chào");
  await user.click(screen.getByRole("button", { name: /gửi/i }));
  expect(onSend).toHaveBeenCalledWith("xin chào");
});

it("hiện nút đính kèm khi có onAttach", () => {
  render(<InputBar onSend={() => {}} streaming={false} onStop={() => {}} onAttach={() => {}} />);
  expect(screen.getByRole("button", { name: /đính kèm/i })).toBeInTheDocument();
});

it("không hiện nút đính kèm khi không có onAttach", () => {
  render(<InputBar onSend={() => {}} streaming={false} onStop={() => {}} />);
  expect(screen.queryByRole("button", { name: /đính kèm/i })).toBeNull();
});

it("dùng class input-bar làm contract giao diện dùng chung", () => {
  const { container } = render(
    <InputBar onSend={() => {}} streaming={false} onStop={() => {}} />
  );
  expect(container.firstElementChild).toHaveClass("input-bar");
});
