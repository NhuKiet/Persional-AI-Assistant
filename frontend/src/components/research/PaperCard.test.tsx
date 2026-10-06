import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { PaperCard, type Paper } from "./PaperCard";

const paper: Paper = { source: "arxiv", title: "Attention Is All You Need", url: "https://arxiv.org/abs/1706.03762" };

it("opens the deep dive from the keyboard, through a real button", async () => {
  // Clicking anywhere on the card is a convenience for the mouse; the button
  // inside it is what a keyboard or a screen reader reaches.
  const onDeepDive = vi.fn();
  const user = userEvent.setup();
  render(<PaperCard paper={paper} onDeepDive={onDeepDive} />);

  await user.tab(); // the "View" link
  await user.tab();
  expect(screen.getByRole("button", { name: /Deep dive/ })).toHaveFocus();
  await user.keyboard("{Enter}");

  expect(onDeepDive).toHaveBeenCalledTimes(1); // once: not again as a click on the card
  expect(onDeepDive).toHaveBeenCalledWith(paper);
});

it("opening the paper's own page does not start a deep dive", async () => {
  const onDeepDive = vi.fn();
  render(<PaperCard paper={paper} onDeepDive={onDeepDive} />);

  await userEvent.click(screen.getByRole("link", { name: /View/ }));

  expect(onDeepDive).not.toHaveBeenCalled();
});
