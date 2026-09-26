import katex from "katex";
import { describe, expect, it } from "vitest";
import { normalizeHmerLatex } from "./hmerLatex";

/** The SwinCoMER vocabulary (comer/datamodule/dictionary.txt) has no `\{`,
 *  `\}` or `\\` token — only a lone `\` — and no environment names, so the
 *  model spells them out token by token. */

const renders = (latex: string) => () => katex.renderToString(latex, { throwOnError: true });

describe("normalizeHmerLatex", () => {
  it("joins environment names the model spells letter by letter", () => {
    expect(normalizeHmerLatex("\\begin { m a t r i x } 1 \\end { m a t r i x }"))
      .toBe("\\begin{matrix} 1 \\end{matrix}");
    expect(normalizeHmerLatex("\\begin { p m a t r i x } a \\end { p m a t r i x }"))
      .toBe("\\begin{pmatrix} a \\end{pmatrix}");
  });

  it("turns two lone backslashes into a row break", () => {
    expect(normalizeHmerLatex("1 & 2 \\ \\ 3 & 4")).toBe("1 & 2 \\\\ 3 & 4");
  });

  it("turns a lone backslash before a brace into an escaped brace", () => {
    expect(normalizeHmerLatex("\\ { x \\ }")).toBe("\\{ x \\}");
  });

  it("reads a row break followed by an escaped brace in that order", () => {
    expect(normalizeHmerLatex("a \\ \\ \\ { b")).toBe("a \\\\ \\{ b");
  });

  it("leaves ordinary output alone", () => {
    const latex = "x ^ { 2 } = \\sum \\limits _ { a = 1 } ^ { 3 } x _ { a } ^ { 2 }";
    expect(normalizeHmerLatex(latex)).toBe(latex);
  });

  it("makes the model's real matrix output renderable", () => {
    // Read from a hand-drawn "2+3" during testing, 2026-09-26.
    const raw = "\\ { \\begin { m a t r i x } 2 \\ \\ 7 \\end { m a t r i x } \\ }";
    expect(renders(raw)).toThrow();

    const fixed = normalizeHmerLatex(raw);

    expect(fixed).toBe("\\{ \\begin{matrix} 2 \\\\ 7 \\end{matrix} \\}");
    expect(renders(fixed)).not.toThrow();
  });
});
