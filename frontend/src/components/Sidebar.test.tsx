import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

const SESSIONS = [
  { id: "s1", title: "Giải phương trình bậc hai", ts: Date.now() },
  { id: "s2", title: "Tóm tắt bài báo RAG", ts: Date.now() - 1000 },
];

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function renderSidebar(overrides: Partial<Parameters<typeof Sidebar>[0]> = {}, at = "/") {
  const props = {
    open: true, onToggle: vi.fn(), sessions: SESSIONS, activeId: "s1",
    onSelect: vi.fn(), onDelete: vi.fn(), onClearAll: vi.fn(), onNewChat: vi.fn(),
    ...overrides,
  };
  render(<MemoryRouter initialEntries={[at]}><Sidebar {...props} /><Where /></MemoryRouter>);
  return props;
}

it("leads back to the chat page from a tool page", async () => {
  const props = renderSidebar({ toolLabel: "Research" }, "/research");
  const chat = screen.getByRole("button", { name: "Trò chuyện" });

  expect(chat).not.toHaveAttribute("aria-current");
  await userEvent.click(chat);

  expect(screen.getByTestId("where")).toHaveTextContent("/chat");
  expect(props.onNewChat).not.toHaveBeenCalled();
});

it("on the chat page itself, returns to the start screen", async () => {
  const props = renderSidebar({}, "/chat");
  const chat = screen.getByRole("button", { name: "Trò chuyện" });

  expect(chat).toHaveAttribute("aria-current", "page");
  await userEvent.click(chat);

  expect(props.onNewChat).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("where")).toHaveTextContent("/chat");
});

it("reopens an earlier conversation from the keyboard", async () => {
  const user = userEvent.setup();
  const props = renderSidebar();

  const earlier = screen.getByRole("button", { name: "Tóm tắt bài báo RAG" });
  earlier.focus();
  await user.keyboard("{Enter}");

  expect(props.onSelect).toHaveBeenCalledTimes(1);
  expect(props.onSelect).toHaveBeenCalledWith(SESSIONS[1]);
});

it("marks the conversation that is open", () => {
  renderSidebar();

  expect(screen.getByRole("button", { name: "Giải phương trình bậc hai" })).toHaveAttribute("aria-current", "true");
  expect(screen.getByRole("button", { name: "Tóm tắt bài báo RAG" })).not.toHaveAttribute("aria-current");
});

it("deletes a conversation without opening it", async () => {
  const props = renderSidebar();

  await userEvent.click(screen.getAllByTitle("Xóa")[1]);

  expect(props.onDelete).toHaveBeenCalledWith("s2");
  expect(props.onSelect).not.toHaveBeenCalled();
});
