import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "../App";

test.each([
  ["/", /KiNg/i],
  ["/chat", /KiNg/i],
  ["/research", /Research/i],
  ["/coding", /Coding/i],
  ["/pdf", /PDF/i],
  ["/tool/homework", /Bài tập/i],
])("keeps public route %s renderable", async (path, expectedContent) => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );

  expect(await screen.findAllByText(expectedContent)).not.toHaveLength(0);
});
