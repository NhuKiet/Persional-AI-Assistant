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

export function findExcerptSpanIndexes(spanTexts: string[], excerpt: string): number[] {
  let normalizedText = "";
  const spanByOffset: number[] = [];
  let pendingWhitespaceSpan: number | null = null;

  spanTexts.forEach((spanText, spanIndex) => {
    for (const character of spanText) {
      if (/\s/u.test(character)) {
        if (normalizedText && pendingWhitespaceSpan === null) {
          pendingWhitespaceSpan = spanIndex;
        }
        continue;
      }

      if (pendingWhitespaceSpan !== null) {
        normalizedText += " ";
        spanByOffset.push(pendingWhitespaceSpan);
        pendingWhitespaceSpan = null;
      }

      const normalizedCharacter = character.toLocaleLowerCase("vi");
      normalizedText += normalizedCharacter;
      for (let offset = 0; offset < normalizedCharacter.length; offset += 1) {
        spanByOffset.push(spanIndex);
      }
    }
  });

  const needle = normalizeSearchText(excerpt);
  if (!needle) return [];
  const start = normalizedText.indexOf(needle);
  if (start < 0) return [];

  return Array.from(new Set(spanByOffset.slice(start, start + needle.length)));
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
