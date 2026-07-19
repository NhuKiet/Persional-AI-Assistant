import type { PDFDocumentProxy } from "pdfjs-dist";

export interface PdfSearchPage {
  page: number;
  text: string;
}

export interface TextRange {
  start: number;
  end: number;
}

export function clampPage(page: number, totalPages: number): number {
  if (totalPages < 1) return 1;
  return Math.min(totalPages, Math.max(1, Math.trunc(page)));
}

export function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase("vi").replace(/\s+/g, " ").trim();
}

export function findExcerptRange(pageText: string, excerpt: string): TextRange | null {
  const haystack = normalizeSearchText(pageText);
  const needle = normalizeSearchText(excerpt);
  if (!needle) return null;

  const start = haystack.indexOf(needle);
  return start < 0 ? null : { start, end: start + needle.length };
}

export async function buildPdfSearchPages(pdf: PDFDocumentProxy): Promise<PdfSearchPage[]> {
  const pages: PdfSearchPage[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .filter(Boolean)
      .join(" ");

    pages.push({ page: pageNumber, text });
  }

  return pages;
}
