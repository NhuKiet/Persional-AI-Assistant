import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import { AssistantBubble } from "./AssistantBubble";

function bubbleAt(path: string) {
  render(<MemoryRouter initialEntries={[path]}><AssistantBubble /></MemoryRouter>);
  return screen.getByRole("button", { name: "Bật trợ lý nhanh" }).parentElement;
}

// The corner is CSS; what the component decides is which page asks for which.
// On the landing page the bottom-left corner holds the portfolio carousel's
// "previous" button, so the bubble docks right there (assistant-bubble.css).
it("docks to the right on the landing page", () => {
  expect(bubbleAt("/")).toHaveClass("bubble-root--right");
});

it.each(["/chat", "/research", "/pdf", "/news"])("stays on the left on %s", (path) => {
  expect(bubbleAt(path)).not.toHaveClass("bubble-root--right");
});
