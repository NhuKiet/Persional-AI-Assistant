import { mapOutsideCode } from "./markdownProse";

/** Rewrite the math delimiters LLMs actually emit into ones remark-math parses.
 *
 *  OpenAI and Anthropic models write `\( x \)` inline and `\[ x \]` for
 *  display. To CommonMark, `\(` is just an escaped "(" — the backslash is
 *  dropped and the formula comes out as plain text. remark-math reads `$$`,
 *  so: `\( x \)` → `$$x$$` (inline) and `\[ x \]` → a `$$` block on its own
 *  lines. A lone line `$$x$$` also becomes a block, since that is what the
 *  model meant by it.
 *
 *  Single `$` is left alone (remark-math runs with singleDollarTextMath off):
 *  "giá $5 và $10" is money far more often than it is math.
 *
 *  Fenced code and inline code spans are skipped, so `\(` in a regex or a
 *  LaTeX snippet shown as code stays exactly as written. */
export function normalizeMath(src: string): string {
  if (!src.includes("\\(") && !src.includes("\\[") && !src.includes("$$")) return src;
  return mapOutsideCode(src, convertMath);
}

function convertMath(text: string): string {
  return text
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, body: string) => `\n\n$$\n${body.trim()}\n$$\n\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, body: string) => `$$${body.trim()}$$`)
    .replace(/^[ \t]*\$\$([^\n$]+?)\$\$[ \t]*$/gm, (_, body: string) => `$$\n${body.trim()}\n$$`);
}
