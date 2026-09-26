import { describe, expect, it } from "vitest";
import { doubtfulTokens, locateToken, tokenSpans } from "./hmerDoubt";

describe("tokenSpans", () => {
  it("maps each whitespace-split token to its place in the LaTeX", () => {
    expect(tokenSpans("\\frac { 1 } { 2 }", ["\\frac", "{", "1", "}", "{", "2", "}"])).toEqual([
      [0, 5], [6, 7], [8, 9], [10, 11], [12, 13], [14, 15], [16, 17],
    ]);
  });

  it("returns null when the tokens don't belong to the string", () => {
    expect(tokenSpans("x + 1", ["x", "-", "1"])).toBeNull();
  });
});

describe("doubtfulTokens", () => {
  const latex = "a + b = c ^ { 2 }";
  const tokens = latex.split(" ");

  it("keeps the least certain ones, then lists them in reading order", () => {
    const probs = [0.2, 1, 0.45, 1, 0.1, 0.3, 1, 0.4, 1];
    const picked = doubtfulTokens(latex, tokens, probs, 3);

    expect(picked.map((t) => t.token)).toEqual(["a", "c", "^"]);
    expect(picked.map((t) => t.prob)).toEqual([0.2, 0.1, 0.3]);
  });

  it("ignores tokens at or above the threshold", () => {
    expect(doubtfulTokens(latex, tokens, tokens.map(() => 0.5))).toEqual([]);
  });

  it("treats a missing probability as certain", () => {
    expect(doubtfulTokens("x", ["x"], [])).toEqual([]);
  });
});

describe("locateToken", () => {
  it("uses the original span while the text is unchanged", () => {
    expect(locateToken("x ^ { 7 }", "x ^ { 7 }", [6, 7], "7")).toEqual([6, 7]);
  });

  it("picks the occurrence nearest to where the token used to be", () => {
    // Two 7s after the edit; the one at 10 is closer to the original 6 than 0.
    expect(locateToken("7 + x ^ { 7 }", "x ^ { 7 }", [6, 7], "7")).toEqual([10, 11]);
  });

  it("returns null once the token has been edited away", () => {
    expect(locateToken("x ^ { 2 }", "x ^ { 7 }", [6, 7], "7")).toBeNull();
  });
});
