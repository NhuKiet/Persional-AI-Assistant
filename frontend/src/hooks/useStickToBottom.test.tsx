import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useStickToBottom } from "./useStickToBottom";

/** jsdom has no layout: give the scroll box explicit metrics. */
function metrics(el: HTMLElement, { scrollHeight, clientHeight, scrollTop }: Record<string, number>) {
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
  Object.defineProperty(el, "scrollTop", { value: scrollTop, writable: true, configurable: true });
}

function Chat({ content, turn = 1 }: { content: string; turn?: number }) {
  const { ref, showJump, jumpToBottom } = useStickToBottom<HTMLDivElement>(content, turn);
  return (
    <div>
      <div data-testid="box" ref={ref}>{content}</div>
      {showJump && <button onClick={jumpToBottom}>Tin mới</button>}
    </div>
  );
}

describe("useStickToBottom", () => {
  it("follows new content while the reader is at the bottom", () => {
    const { rerender } = render(<Chat content="a" />);
    const box = screen.getByTestId("box");
    metrics(box, { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });

    rerender(<Chat content="ab" />);

    expect(box.scrollTop).toBe(1000);
    expect(screen.queryByRole("button", { name: "Tin mới" })).toBeNull();
  });

  it("stays put after the reader scrolls up, and offers a jump instead", () => {
    const { rerender } = render(<Chat content="a" />);
    const box = screen.getByTestId("box");
    metrics(box, { scrollHeight: 1000, clientHeight: 400, scrollTop: 100 });
    fireEvent.scroll(box);

    rerender(<Chat content="ab" />);

    expect(box.scrollTop).toBe(100);
    expect(screen.getByRole("button", { name: "Tin mới" })).toBeInTheDocument();
  });

  it("jumps back down and follows again", () => {
    const { rerender } = render(<Chat content="a" />);
    const box = screen.getByTestId("box");
    metrics(box, { scrollHeight: 1000, clientHeight: 400, scrollTop: 100 });
    fireEvent.scroll(box);
    rerender(<Chat content="ab" />);
    box.scrollTo = vi.fn(({ top }: ScrollToOptions) => { box.scrollTop = top ?? 0; }) as never;

    fireEvent.click(screen.getByRole("button", { name: "Tin mới" }));

    expect(box.scrollTop).toBe(1000);
    expect(screen.queryByRole("button", { name: "Tin mới" })).toBeNull();
    metrics(box, { scrollHeight: 1200, clientHeight: 400, scrollTop: 1000 });
    rerender(<Chat content="abc" />);
    expect(box.scrollTop).toBe(1200);
  });

  it("follows again when a new turn starts, even after the reader scrolled up", () => {
    // Sending, editing or regenerating is the reader's own action: show it.
    const { rerender } = render(<Chat content="a" turn={1} />);
    const box = screen.getByTestId("box");
    metrics(box, { scrollHeight: 1000, clientHeight: 400, scrollTop: 100 });
    fireEvent.scroll(box);

    rerender(<Chat content="ab" turn={2} />);

    expect(box.scrollTop).toBe(1000);
    expect(screen.queryByRole("button", { name: "Tin mới" })).toBeNull();
  });

  it("counts a reader within a few lines of the bottom as at the bottom", () => {
    const { rerender } = render(<Chat content="a" />);
    const box = screen.getByTestId("box");
    metrics(box, { scrollHeight: 1000, clientHeight: 400, scrollTop: 560 });
    act(() => { fireEvent.scroll(box); });

    rerender(<Chat content="ab" />);

    expect(box.scrollTop).toBe(1000);
  });
});
