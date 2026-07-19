import { describe, expect, it } from "vitest";
import {
  buildPdfSearchPages,
  clampPage,
  findExcerptRange,
  findExcerptSpanIndexes,
  normalizeSearchText,
  resolvePdfOutline,
  searchPdfPages,
} from "./pdfDocument";

describe("PDF document helpers", () => {
  it("searches case-insensitively while preserving Vietnamese accents", () => {
    const pages = [
      { page: 1, text: "Dữ liệu lớn và Embeddings" },
      { page: 2, text: "Du lieu khong dau" },
    ];

    expect(searchPdfPages(pages, "EMBEDDINGS")).toEqual([
      {
        page: 1,
        excerpt: "Dữ liệu lớn và Embeddings",
        matchText: "EMBEDDINGS",
        matchStart: 15,
        matchEnd: 25,
      },
    ]);
    expect(searchPdfPages(pages, "dữ liệu")).toHaveLength(1);
    expect(searchPdfPages(pages, "du lieu")).toHaveLength(1);
  });

  it("keeps result order and reports offsets from the original page text", () => {
    const pages = [
      { page: 8, text: "Trước  Agent\ngraph sau" },
      { page: 3, text: "Agent graph thứ hai" },
    ];

    expect(searchPdfPages(pages, "agent graph")).toEqual([
      expect.objectContaining({ page: 8, matchStart: 7, matchEnd: 18 }),
      expect.objectContaining({ page: 3, matchStart: 0, matchEnd: 11 }),
    ]);
  });

  it("matches canonically equivalent Vietnamese text while retaining original offsets", () => {
    const decomposed = "Trước u\u031B\u0303 liệu";
    const [decomposedResult] = searchPdfPages([{ page: 4, text: decomposed }], "Ữ");
    const [precomposedResult] = searchPdfPages([{ page: 5, text: "Trước ữ liệu" }], "u\u031B\u0303");

    expect(decomposedResult).toMatchObject({ page: 4, matchStart: 6, matchEnd: 9 });
    expect(decomposed.slice(decomposedResult.matchStart, decomposedResult.matchEnd)).toBe("u\u031B\u0303");
    expect(precomposedResult).toMatchObject({ page: 5, matchStart: 6, matchEnd: 7 });
  });

  it("clamps navigation to the loaded page range", () => {
    expect(clampPage(0, 12)).toBe(1);
    expect(clampPage(7, 12)).toBe(7);
    expect(clampPage(99, 12)).toBe(12);
  });

  it("normalizes case and whitespace without stripping accents", () => {
    expect(normalizeSearchText("  Dữ liệu\nLớN ")).toBe("dữ liệu lớn");
  });

  it("returns the matching range for an excerpt", () => {
    expect(findExcerptRange("Alpha Embeddings Omega", "embeddings")).toEqual({
      start: 6,
      end: 16,
    });
  });

  it("maps normalized excerpt offsets back to the correct text spans", () => {
    expect(findExcerptSpanIndexes(["Alpha  ", "Embeddings"], "embeddings")).toEqual([1]);
  });

  it("builds canonical searchable page text from PDF.js", async () => {
    const pdf = {
      numPages: 1,
      getPage: async () => ({
        getTextContent: async () => ({
          items: [{ str: "Dữ liệu" }, { str: "lớn" }],
        }),
      }),
    };

    await expect(buildPdfSearchPages(pdf as never)).resolves.toEqual([
      { page: 1, text: "Dữ liệu lớn" },
    ]);
  });

  it("resolves named and explicit destinations recursively", async () => {
    const pdf = {
      numPages: 10,
      getOutline: async () => [{
        title: "Chương",
        dest: "chapter",
        items: [{ title: "Mục", dest: [{ num: 9, gen: 0 }], items: [] }],
      }],
      getDestination: async () => [{ num: 4, gen: 0 }],
      getPageIndex: async (ref: { num: number }) => ref.num,
    };

    await expect(resolvePdfOutline(pdf as never)).resolves.toEqual([{
      title: "Chương",
      page: 5,
      children: [{ title: "Mục", page: 10, children: [] }],
    }]);
  });

  it("promotes valid children when a parent destination is missing or throws", async () => {
    const pdf = {
      numPages: 3,
      getOutline: async () => [
        {
          title: "Nhóm không có đích",
          dest: null,
          items: [{ title: "Con hợp lệ", dest: [0], items: [] }],
        },
        {
          title: "Nhóm đích lỗi",
          dest: "broken",
          items: [{ title: "Con vẫn hợp lệ", dest: [1], items: [] }],
        },
      ],
      getDestination: async () => { throw new Error("missing destination"); },
      getPageIndex: async () => 0,
    };

    await expect(resolvePdfOutline(pdf as never)).resolves.toEqual([
      { title: "Con hợp lệ", page: 1, children: [] },
      { title: "Con vẫn hợp lệ", page: 2, children: [] },
    ]);
  });

  it("rejects invalid numeric destination indexes without losing valid descendants or siblings", async () => {
    const pdf = {
      numPages: 3,
      getOutline: async () => [
        { title: "Âm", dest: [-1], items: [] },
        { title: "Quá trang", dest: [3], items: [] },
        { title: "Thập phân", dest: [1.5], items: [] },
        {
          title: "Cha không hợp lệ",
          dest: [-1],
          items: [{ title: "Con hợp lệ", dest: [2], items: [] }],
        },
        { title: "Anh chị em hợp lệ", dest: [1], items: [] },
      ],
      getDestination: async () => null,
      getPageIndex: async () => 0,
    };

    await expect(resolvePdfOutline(pdf as never)).resolves.toEqual([
      { title: "Con hợp lệ", page: 3, children: [] },
      { title: "Anh chị em hợp lệ", page: 2, children: [] },
    ]);
  });

  it("rejects invalid page indexes returned for destination references", async () => {
    const pdf = {
      numPages: 3,
      getOutline: async () => [
        { title: "Âm", dest: [{ num: -1, gen: 0 }], items: [] },
        { title: "Quá trang", dest: [{ num: 3, gen: 0 }], items: [] },
        { title: "Thập phân", dest: [{ num: 1.5, gen: 0 }], items: [] },
        { title: "Hợp lệ", dest: [{ num: 1, gen: 0 }], items: [] },
      ],
      getDestination: async () => null,
      getPageIndex: async (ref: { num: number }) => ref.num,
    };

    await expect(resolvePdfOutline(pdf as never)).resolves.toEqual([
      { title: "Hợp lệ", page: 2, children: [] },
    ]);
  });
});
