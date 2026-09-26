/** Turn SwinCoMER output into LaTeX that KaTeX (and Overleaf) accept.
 *
 *  The model's vocabulary (comer/datamodule/dictionary.txt) has no `\{`, `\}`
 *  or `\\` token — only a lone `\` — and no environment names, so it writes:
 *    `\begin { m a t r i x }` for `\begin{matrix}`
 *    `\ \`                    for the row break `\\`
 *    `\ {` / `\ }`            for the escaped braces `\{` / `\}`
 *  Each of those is invalid LaTeX as written. Everything else, including the
 *  model's token spacing, is left as it is.
 *
 *  Only the text shown and copied is normalized: /api/hmer/explain still
 *  gets the raw string, because the backend splits it into model tokens. */
export function normalizeHmerLatex(latex: string): string {
  return latex
    .replace(
      /\\(begin|end)\s*\{\s*([A-Za-z*](?:\s*[A-Za-z*])*)\s*\}/g,
      (_, command: string, name: string) => `\\${command}{${name.replace(/\s+/g, "")}}`,
    )
    // Pairs first, so `\ \ \ {` reads as a row break then an escaped brace.
    .replace(/\\ \\(?![A-Za-z])/g, "\\\\")
    .replace(/(^|[^\\])\\ ([{}])/g, "$1\\$2");
}
