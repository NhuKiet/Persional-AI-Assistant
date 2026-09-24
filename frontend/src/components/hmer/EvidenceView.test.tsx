import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EvidenceView } from "./EvidenceView";
import type { HmerExplanation } from "../../lib/hmerApi";

/** 2 × 3 grid, three tokens: "x" rests on cell 0, "+" on cells 4 and 5
 *  (twice as much on 5), "{" has no single-cell evidence. */
const EXPLANATION: HmerExplanation = {
  tokens: ["x", "+", "{"],
  token_probs: [0.95, 0.6, 1],
  evidence: {
    rows: 2,
    cols: 3,
    weights: [
      [1, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 1 / 3, 2 / 3],
      [0, 0, 0, 0, 0, 0],
    ],
    no_evidence: [false, false, true],
  },
  elapsed_ms: 1500,
};

function renderReady(explanation = EXPLANATION) {
  return render(
    <EvidenceView imageUrl="/img.png" alt="Ảnh công thức" status="ready" explanation={explanation} />,
  );
}

const cells = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>(".hmer-evidence-cell")];
const opacities = (container: HTMLElement) => cells(container).map((c) => Number(c.style.opacity));

describe("EvidenceView", () => {
  it("shows the image and a loading note while the map is on its way", () => {
    render(<EvidenceView imageUrl="/img.png" alt="Ảnh công thức" status="loading" explanation={null} />);

    expect(screen.getByAltText("Ảnh công thức")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/Đang tìm vùng mô hình dựa vào/);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("renders one chip per token, with no overlay until one is chosen", () => {
    const { container } = renderReady();

    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["x", "+", "{"]);
    expect(opacities(container).every((o) => o === 0)).toBe(true);
    expect(screen.getByText(/Vùng sáng: che đi thì mô hình bớt chắc/)).toBeInTheDocument();
  });

  it("lights the cells a token rests on, scaled to its strongest cell", () => {
    const { container } = renderReady();

    fireEvent.mouseEnter(screen.getByRole("button", { name: /^\+/ }));

    expect(opacities(container)).toEqual([0, 0, 0, 0, 0.5, 1]);
  });

  it("follows keyboard focus, and the arrow keys move between tokens", () => {
    const { container } = renderReady();
    const [x, plus] = screen.getAllByRole("button");

    fireEvent.focus(x);
    expect(opacities(container)).toEqual([1, 0, 0, 0, 0, 0]);

    fireEvent.keyDown(x, { key: "ArrowRight" });
    expect(plus).toHaveFocus();
    expect(opacities(container)).toEqual([0, 0, 0, 0, 0.5, 1]);

    fireEvent.keyDown(plus, { key: "ArrowLeft" });
    expect(x).toHaveFocus();
  });

  it("says so for a token no single region decides, instead of drawing noise", () => {
    const { container } = renderReady();

    fireEvent.mouseEnter(screen.getByRole("button", { name: /^\{/ }));

    expect(opacities(container).every((o) => o === 0)).toBe(true);
    expect(screen.getByText(/Không vùng riêng lẻ nào quyết định ký hiệu này/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^\{/ })).toHaveClass("is-flat");
  });

  it("does not hard-code the grid: rows × cols comes from the response", () => {
    const { container } = renderReady();
    const grid = container.querySelector<HTMLElement>(".hmer-evidence-grid")!;

    expect(cells(container)).toHaveLength(6);
    expect(grid.style.gridTemplateColumns).toBe("repeat(3, 1fr)");
    expect(grid.style.gridTemplateRows).toBe("repeat(2, 1fr)");
  });

  it("keeps the image and explains the failure when the map could not be computed", () => {
    render(
      <EvidenceView
        imageUrl="/img.png"
        alt="Ảnh công thức"
        status="error"
        explanation={null}
        error="Không tìm thấy checkpoint"
      />,
    );

    expect(screen.getByAltText("Ảnh công thức")).toBeInTheDocument();
    expect(screen.getByText(/Không tính được vùng mô hình dựa vào/)).toHaveTextContent(/checkpoint/);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
