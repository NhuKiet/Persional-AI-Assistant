import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CodeBlock } from "./CodeBlock";

function renderCode(code: string) {
  const { container } = render(<CodeBlock code={code} />);
  return container.querySelector("pre code")!;
}

describe("CodeBlock highlighting", () => {
  it("never shows highlighter markup as text (string followed by a comment)", () => {
    // The old chained regexes matched `class` inside the span they had just
    // inserted and printed `class="sh-str">` on screen.
    const code = renderCode('x = "hi"  # note');

    expect(code.textContent).toBe('x = "hi"  # note');
    expect(code.querySelector(".sh-str")!.textContent).toBe('"hi"');
    expect(code.querySelector(".sh-cmt")!.textContent).toBe("# note");
  });

  it("does not highlight keywords or numbers inside strings and comments", () => {
    const code = renderCode('s = "class def 42"  # return 7 if True');

    expect(code.querySelectorAll(".sh-str span, .sh-cmt span")).toHaveLength(0);
    expect(code.querySelector(".sh-str")!.textContent).toBe('"class def 42"');
    expect(code.querySelector(".sh-cmt")!.textContent).toBe("# return 7 if True");
  });

  it("highlights keywords and numbers in code", () => {
    const code = renderCode("def f(x):\n    return x * 3.5");

    expect([...code.querySelectorAll(".sh-kw")].map(n => n.textContent)).toEqual(["def", "return"]);
    expect([...code.querySelectorAll(".sh-num")].map(n => n.textContent)).toEqual(["3.5"]);
  });

  it("keeps identifiers that contain keywords or digits intact", () => {
    const code = renderCode("classify = x2 + define");

    expect(code.querySelectorAll(".sh-kw, .sh-num")).toHaveLength(0);
    expect(code.textContent).toBe("classify = x2 + define");
  });

  it("handles triple-quoted strings spanning lines", () => {
    const code = renderCode('doc = """a\n# not a comment\nb"""');

    expect(code.querySelectorAll(".sh-cmt")).toHaveLength(0);
    expect(code.querySelector(".sh-str")!.textContent).toBe('"""a\n# not a comment\nb"""');
  });

  it("escapes HTML in the code", () => {
    const code = renderCode('print("<b>hi</b>")');

    expect(code.querySelector("b")).toBeNull();
    expect(code.textContent).toBe('print("<b>hi</b>")');
  });

  it("copies the raw code", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CodeBlock code={'x = "hi"'} />);

    await userEvent.click(screen.getByRole("button", { name: /copy/i }));

    expect(writeText).toHaveBeenCalledWith('x = "hi"');
  });
});
