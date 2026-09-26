import { describe, expect, it } from "vitest";
import { linkCitations, linkPageCitations, safeHref } from "./citations";

describe("linkCitations", () => {
  it("turns in-range [n] markers into #cite links", () => {
    expect(linkCitations("A [1]. B [2][3].", 3)).toBe("A [1](#cite-1). B [2](#cite-2)[3](#cite-3).");
  });

  it("leaves markers past the last source as plain text", () => {
    expect(linkCitations("A [1] B [5].", 3)).toBe("A [1](#cite-1) B [5].");
  });

  it("does nothing before the sources have arrived", () => {
    expect(linkCitations("A [1].", 0)).toBe("A [1].");
  });

  it("skips code, indexing and existing links", () => {
    const text = "Mảng `a[1]` và a[2], xem [1](https://x.y).\n\n```\nb[1]\n```\nCuối [1].";
    expect(linkCitations(text, 2)).toBe(
      "Mảng `a[1]` và a[2], xem [1](https://x.y).\n\n```\nb[1]\n```\nCuối [1](#cite-1).",
    );
  });
});

describe("linkPageCitations", () => {
  it("turns [Tr.N] for pages the answer drew on into #page links", () => {
    expect(linkPageCitations("Định nghĩa [Tr.3], ví dụ [Tr.12][Tr.3].", [3, 12]))
      .toBe("Định nghĩa [tr.3](#page-3), ví dụ [tr.12](#page-12)[tr.3](#page-3).");
  });

  it("accepts the spellings models actually use", () => {
    expect(linkPageCitations("[tr. 3] [Trang 3] [trang 3] [TR.3]", [3]))
      .toBe("[tr.3](#page-3) [tr.3](#page-3) [tr.3](#page-3) [tr.3](#page-3)");
  });

  it("leaves pages the model was not shown as text", () => {
    expect(linkPageCitations("Xem [Tr.40].", [3])).toBe("Xem [Tr.40].");
  });

  it("leaves code alone", () => {
    expect(linkPageCitations("`[Tr.3]`", [3])).toBe("`[Tr.3]`");
  });
});

describe("safeHref", () => {
  it("keeps http and https links", () => {
    expect(safeHref("https://arxiv.org/abs/1706.03762")).toBe("https://arxiv.org/abs/1706.03762");
    expect(safeHref("http://example.com")).toBe("http://example.com");
  });

  it("drops anything else", () => {
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("  JavaScript:alert(1)")).toBeUndefined();
    expect(safeHref("")).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
  });
});
