import { describe, expect, it } from "vitest";
import {
  buildPdfSearchPages,
  clampPage,
  findExcerptRange,
  findExcerptSpanIndexes,
  normalizeSearchText,
} from "./pdfDocument";

describe("PDF document helpers", () => {
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
});
