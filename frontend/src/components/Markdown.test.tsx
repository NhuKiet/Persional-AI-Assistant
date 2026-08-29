import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Markdown } from "./Markdown";

/** Sơ đồ ASCII trong fence là ca hỏng thật đã gặp ở panel PDF: dấu ``` lọt ra
 *  thành text và khoảng trắng bị gộp làm mất canh cột. */
const DIAGRAM = "User request\n      ↓\n  Supervisor\n ↙    ↓    ↘\nA     B     C";

describe("Markdown", () => {
  it("renders a fenced block as <pre>, preserving whitespace", () => {
    const { container } = render(<Markdown text={"Sơ đồ:\n\n```text\n" + DIAGRAM + "\n```\n\nXong."} />);
    const pre = container.querySelector("pre.md-pre");
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toBe(DIAGRAM);
    expect(pre!.getAttribute("data-lang")).toBe("text");
  });

  it("does not leak the fence markers into the prose", () => {
    const { container } = render(<Markdown text={"a\n```\ncode\n```\nb"} />);
    expect(container.textContent).not.toContain("```");
  });

  it("treats an unterminated fence as a code block (mid-stream)", () => {
    const { container } = render(<Markdown text={"Đang vẽ:\n```text\nUser\n  ↓"} />);
    const pre = container.querySelector("pre.md-pre");
    expect(pre!.textContent).toBe("User\n  ↓");
  });

  it("escapes HTML inside a code block", () => {
    const { container } = render(<Markdown text={"```\n<img onerror=x>\n```"} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("pre")!.textContent).toBe("<img onerror=x>");
  });

  it("still renders inline markdown outside fences", () => {
    render(<Markdown text={"**đậm** và `inline`\n\n```\nx\n```"} />);
    expect(screen.getByText("đậm").tagName).toBe("STRONG");
    expect(screen.getByText("inline").tagName).toBe("CODE");
  });
});
