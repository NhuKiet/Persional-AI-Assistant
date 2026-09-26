/** Python syntax highlighting in one left-to-right pass.
 *
 *  The previous version ran one regex per token kind over the output of the
 *  last: the keyword pass then matched `class` inside `<span class="sh-str">`
 *  it had just inserted and printed the markup on screen. A single regex with
 *  one alternative per kind tokenizes the source once, so a `#` inside a
 *  string or a keyword inside a comment is never re-read, and the tokens are
 *  rendered as React nodes — no HTML string is ever built. */

export type TokenKind = "str" | "cmt" | "kw" | "num" | "plain";

export interface Token {
  kind: TokenKind;
  text: string;
}

const KEYWORDS = [
  "def", "class", "import", "from", "return", "if", "else", "elif", "for", "while",
  "try", "except", "finally", "with", "as", "in", "is", "not", "and", "or", "True",
  "False", "None", "print", "lambda", "yield", "async", "await", "pass", "break",
  "continue", "raise", "global", "nonlocal",
];

// Order of alternatives only matters at the same start position; the scan
// itself always takes the earliest match. Unterminated strings run to the end
// of the line (or of the text, for triple quotes) so code still streaming in
// highlights sensibly.
const PYTHON_TOKEN = new RegExp(
  [
    String.raw`("""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)`,
    String.raw`(#[^\n]*)`,
    String.raw`\b(${KEYWORDS.join("|")})\b`,
    String.raw`\b(\d+(?:\.\d+)?)\b`,
  ].join("|"),
  "g",
);

export function tokenizePython(src: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const m of src.matchAll(PYTHON_TOKEN)) {
    if (m[0] === "") continue;
    const start = m.index ?? 0;
    if (start > last) tokens.push({ kind: "plain", text: src.slice(last, start) });
    const kind: TokenKind = m[1] !== undefined ? "str" : m[2] !== undefined ? "cmt" : m[3] !== undefined ? "kw" : "num";
    tokens.push({ kind, text: m[0] });
    last = start + m[0].length;
  }
  if (last < src.length) tokens.push({ kind: "plain", text: src.slice(last) });
  return tokens;
}

export function isPython(language?: string): boolean {
  return /^(py|python|python3)$/i.test(language ?? "");
}
