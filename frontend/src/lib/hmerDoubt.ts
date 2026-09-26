/** Which recognized symbols deserve a second look, and where they are.
 *
 *  token_probs come from /api/hmer/explain: the teacher-forced probability of
 *  each token given the image and the tokens before it. Uncalibrated — 0.3
 *  does not mean "70 % wrong" — but it ranks tokens well enough to say where
 *  to look first, which is all this is used for. */

/** Below this, a symbol is listed as doubtful. */
export const DOUBT_THRESHOLD = 0.5;

export type Span = [start: number, end: number];

export interface DoubtfulToken {
  index: number;
  token: string;
  prob: number;
  span: Span;
}

/** Character span of each token in `latex`. The backend splits the same
 *  string on whitespace, so walking it left to right finds each token in
 *  order. Null if they don't line up (shouldn't happen). */
export function tokenSpans(latex: string, tokens: string[]): Span[] | null {
  const spans: Span[] = [];
  let from = 0;
  for (const token of tokens) {
    const at = latex.indexOf(token, from);
    if (at === -1) return null;
    spans.push([at, at + token.length]);
    from = at + token.length;
  }
  return spans;
}

/** The least certain symbols (at most `limit`), in reading order. */
export function doubtfulTokens(
  latex: string,
  tokens: string[],
  probs: number[],
  limit = 5,
): DoubtfulToken[] {
  const spans = tokenSpans(latex, tokens);
  if (!spans) return [];
  return tokens
    .map((token, index) => ({ index, token, prob: probs[index] ?? 1, span: spans[index] }))
    .filter((t) => t.prob < DOUBT_THRESHOLD)
    .sort((a, b) => a.prob - b.prob)
    .slice(0, limit)
    .sort((a, b) => a.index - b.index);
}

/** Where `token` is now. Unedited text: its original span. After edits: the
 *  occurrence nearest to where it used to start, or null if it is gone. */
export function locateToken(value: string, original: string, span: Span, token: string): Span | null {
  if (value === original) return span;
  let best = -1;
  for (let at = value.indexOf(token); at !== -1; at = value.indexOf(token, at + 1)) {
    if (best === -1 || Math.abs(at - span[0]) < Math.abs(best - span[0])) best = at;
  }
  return best === -1 ? null : [best, best + token.length];
}
