import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Markdown, preloadMarkdown } from "./Markdown";

/** Sơ đồ ASCII trong fence là ca hỏng thật đã gặp ở panel PDF: dấu ``` lọt ra
 *  thành text và khoảng trắng bị gộp làm mất canh cột. */
const DIAGRAM = "User request\n      ↓\n  Supervisor\n ↙    ↓    ↘\nA     B     C";

// The renderer is a lazy chunk; load it once so these tests render in one pass.
beforeAll(async () => { await preloadMarkdown(); });

describe("Markdown — code blocks", () => {
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

  it("labels the block with its language and copies the raw code", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<Markdown text={"```python\nx = \"hi\"  # note\n```"} />);

    expect(screen.getByText("python")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /copy/i }));

    expect(writeText).toHaveBeenCalledWith('x = "hi"  # note');
  });

  it("does not turn math delimiters inside code into formulas", () => {
    const { container } = render(<Markdown text={"`\\(x\\)` và\n\n```\n\\[a+b\\]\n```"} />);
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toContain("\\(x\\)");
    expect(container.querySelector("pre")!.textContent).toBe("\\[a+b\\]");
  });
});

describe("Markdown — prose", () => {
  it("still renders inline markdown outside fences", () => {
    render(<Markdown text={"**đậm** và `inline`\n\n```\nx\n```"} />);
    expect(screen.getByText("đậm").tagName).toBe("STRONG");
    expect(screen.getByText("inline").tagName).toBe("CODE");
  });

  it("renders a GFM table inside a horizontally scrollable wrapper", () => {
    const { container } = render(<Markdown text={"| Model | Giá |\n|---|---|\n| GPT-4o | $5 |"} />);
    const table = container.querySelector(".md-table-wrap table");
    expect(table).not.toBeNull();
    expect(screen.getByRole("columnheader", { name: "Model" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "GPT-4o" })).toBeInTheDocument();
    expect(container.textContent).not.toContain("|---|");
  });

  it("keeps single line breaks, as the previous renderer did", () => {
    const { container } = render(<Markdown text={"Bước 1: mở file\nBước 2: chạy lệnh"} />);
    expect(container.querySelectorAll("p br")).toHaveLength(1);
  });

  it("renders numbered lists and blockquotes", () => {
    const { container } = render(<Markdown text={"1. Một\n2. Hai\n\n> Trích dẫn"} />);
    expect(container.querySelectorAll("ol > li")).toHaveLength(2);
    expect(container.querySelector("blockquote")!.textContent).toContain("Trích dẫn");
  });

  it("opens links in a new tab without handing over window.opener", () => {
    render(<Markdown text={"Xem [OpenAI](https://openai.com/news)."} />);
    const link = screen.getByRole("link", { name: "OpenAI" });
    expect(link).toHaveAttribute("href", "https://openai.com/news");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("drops javascript: links", () => {
    const { container } = render(<Markdown text={"[bấm](javascript:alert(1))"} />);
    const hrefs = [...container.querySelectorAll("a")].map(a => a.getAttribute("href") ?? "");
    expect(hrefs.some(h => h.toLowerCase().startsWith("javascript:"))).toBe(false);
  });

  it("does not render raw HTML from the model", () => {
    const { container } = render(<Markdown text={'Xin chào <img src=x onerror="alert(1)"> <script>alert(1)</script>'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });
});

describe("Markdown — citations", () => {
  const SOURCES = [
    { title: "Attention Is All You Need", url: "https://arxiv.org/abs/1706.03762", source: "arxiv", snippet: "The dominant sequence transduction models…" },
    { title: "Bài blog", url: "javascript:alert(1)", source: "web" },
  ];

  it("turns [n] into a numbered link to that source, with a hover card", () => {
    const { container } = render(<Markdown text={"Transformer dùng attention [1]."} citations={SOURCES} />);

    const link = screen.getByRole("link", { name: "Nguồn 1: Attention Is All You Need" });
    expect(link).toHaveTextContent("1");
    expect(link).toHaveAttribute("href", "https://arxiv.org/abs/1706.03762");
    expect(link).toHaveAttribute("target", "_blank");
    const card = container.querySelector(".cite-card")!;
    expect(card).toHaveTextContent("arxiv.org");
    expect(card).toHaveTextContent("The dominant sequence transduction models");
  });

  it("opens the card inward when the chip is near the right edge", () => {
    const { container } = render(<Markdown text={"Cuối dòng [1]."} citations={SOURCES} />);
    const chip = container.querySelector(".cite") as HTMLElement;
    chip.getBoundingClientRect = () => ({ left: window.innerWidth - 20, right: window.innerWidth - 8 }) as DOMRect;

    fireEvent.focus(screen.getByRole("link", { name: /Nguồn 1/ }));

    expect(container.querySelector(".cite-card")).toHaveClass("cite-card--right");
  });

  it("does not link a source whose URL isn't http(s)", () => {
    const { container } = render(<Markdown text={"Xem [2]."} citations={SOURCES} />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelector(".cite")).toHaveTextContent("2");
  });

  it("leaves [n] as text without sources", () => {
    const { container } = render(<Markdown text={"Xem [1]."} />);

    expect(container.querySelector(".cite")).toBeNull();
    expect(container.textContent).toContain("[1]");
  });
});

describe("Markdown — PDF page citations", () => {
  const PAGES = [
    { page: 3, chunk_index: 0, excerpt: "Self-attention tính trọng số giữa mọi cặp token." },
    { page: 12, chunk_index: 4, excerpt: "Bảng 2 so sánh BLEU trên WMT 2014." },
  ];

  it("turns [Tr.N] into a chip that opens that page with its passage", () => {
    const onOpenPage = vi.fn();
    const { container } = render(
      <Markdown text={"Attention thay RNN [Tr.3]."} pageSources={PAGES} onOpenPage={onOpenPage} />,
    );

    const chip = screen.getByRole("button", { name: "Mở trang 3 trong tài liệu" });
    expect(chip).toHaveTextContent("tr.3");
    expect(container.querySelector(".cite-card")).toHaveTextContent("Self-attention tính trọng số");
    fireEvent.click(chip);

    expect(onOpenPage).toHaveBeenCalledWith(PAGES[0]);
  });

  it("leaves a page the answer did not draw on as text", () => {
    render(<Markdown text={"Xem [Tr.40]."} pageSources={PAGES} onOpenPage={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /Mở trang/ })).toBeNull();
    expect(screen.getByText(/\[Tr\.40\]/)).toBeInTheDocument();
  });
});

describe("Markdown — lazy renderer", () => {
  it("shows plain text until the renderer chunk arrives, then formats it", async () => {
    vi.resetModules();
    const { Markdown: Fresh } = await import("./Markdown");
    const { container } = render(<Fresh text="**đậm**" />);

    expect(container.querySelector(".md-plain")!.textContent).toBe("**đậm**");
    expect((await screen.findByText("đậm")).tagName).toBe("STRONG");
  });
});

describe("Markdown — math", () => {
  it("renders \\( \\) as inline math", () => {
    const { container } = render(<Markdown text={"Ta có \\(x^2 + 1\\) luôn dương."} />);
    expect(container.querySelector("p .katex")).not.toBeNull();
    expect(container.querySelector(".katex-display")).toBeNull();
  });

  it("renders \\[ \\] and $$ blocks as display math", () => {
    const { container } = render(
      <Markdown text={"Công thức:\n\n\\[\\frac{a}{b}\\]\n\nvà\n\n$$\nE = mc^2\n$$"} />,
    );
    expect(container.querySelectorAll(".katex-display")).toHaveLength(2);
  });

  it("leaves dollar amounts alone", () => {
    const { container } = render(<Markdown text={"Gói Pro giá $5 và gói Team giá $10 mỗi tháng."} />);
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toContain("$5 và gói Team giá $10");
  });

  it("shows a broken formula as an error instead of crashing the message", () => {
    const { container } = render(<Markdown text={"Lỗi: \\(\\frac{1}{\\)"} />);
    expect(container.textContent).toContain("Lỗi:");
  });
});
