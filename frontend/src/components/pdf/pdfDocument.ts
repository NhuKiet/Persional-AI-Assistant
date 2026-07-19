import type { PDFDocumentProxy } from "pdfjs-dist";

export interface PdfSearchPage {
  page: number;
  text: string;
}

export interface PdfSearchResult {
  page: number;
  excerpt: string;
  matchText: string;
  matchStart: number;
  matchEnd: number;
}

export interface TextRange {
  start: number;
  end: number;
}

export interface ResolvedOutlineItem {
  title: string;
  page: number;
  children: ResolvedOutlineItem[];
}

type PdfPageReference = Parameters<PDFDocumentProxy["getPageIndex"]>[0];

export function clampPage(page: number, totalPages: number): number {
  if (totalPages < 1) return 1;
  return Math.min(totalPages, Math.max(1, Math.trunc(page)));
}

export function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase("vi").normalize("NFC").replace(/\s+/g, " ").trim();
}

interface NormalizedSearchText {
  text: string;
  starts: number[];
  ends: number[];
}

function normalizeSearchTextWithOffsets(value: string): NormalizedSearchText {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let offset = 0;
  let whitespaceStart: number | null = null;
  let cluster = "";
  let clusterStart = 0;
  let clusterEnd = 0;

  const appendCluster = () => {
    if (!cluster) return;

    if (/^\s+$/u.test(cluster)) {
      if (text && whitespaceStart === null) whitespaceStart = clusterStart;
    } else {
      if (whitespaceStart !== null) {
        text += " ";
        starts.push(whitespaceStart);
        ends.push(clusterStart);
        whitespaceStart = null;
      }

      const normalizedCluster = cluster.toLocaleLowerCase("vi").normalize("NFC");
      text += normalizedCluster;
      for (let index = 0; index < normalizedCluster.length; index += 1) {
        starts.push(clusterStart);
        ends.push(clusterEnd);
      }
    }

    cluster = "";
  };

  for (const character of value) {
    const characterEnd = offset + character.length;
    if (/\p{M}/u.test(character) && cluster && !/^\s+$/u.test(cluster)) {
      cluster += character;
      clusterEnd = characterEnd;
    } else {
      appendCluster();
      cluster = character;
      clusterStart = offset;
      clusterEnd = characterEnd;
    }
    offset = characterEnd;
  }
  appendCluster();

  return { text, starts, ends };
}

export function searchPdfPages(pages: PdfSearchPage[], query: string): PdfSearchResult[] {
  const needle = normalizeSearchText(query);
  if (!needle) return [];

  return pages.flatMap((page) => {
    const normalized = normalizeSearchTextWithOffsets(page.text);
    const matchStart = normalized.text.indexOf(needle);
    if (matchStart < 0) return [];

    const matchEnd = matchStart + needle.length;
    return [{
      page: page.page,
      excerpt: page.text.slice(0, 180),
      matchText: query,
      matchStart: normalized.starts[matchStart],
      matchEnd: normalized.ends[matchEnd - 1],
    }];
  });
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

function isPageReference(value: unknown): value is PdfPageReference {
  return typeof value === "object" && value !== null
    && "num" in value && typeof value.num === "number"
    && "gen" in value && typeof value.gen === "number";
}

async function destinationPage(
  pdf: PDFDocumentProxy,
  dest: string | unknown[],
): Promise<number | null> {
  try {
    const explicit = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
    if (!explicit?.length) return null;

    const pageRef = explicit[0];
    if (typeof pageRef === "number") return pageIndexToPageNumber(pdf, pageRef);
    if (!isPageReference(pageRef)) return null;
    return pageIndexToPageNumber(pdf, await pdf.getPageIndex(pageRef));
  } catch {
    return null;
  }
}

function pageIndexToPageNumber(pdf: PDFDocumentProxy, index: number): number | null {
  if (!Number.isInteger(index) || index < 0 || index >= pdf.numPages) return null;
  return index + 1;
}

export async function resolvePdfOutline(pdf: PDFDocumentProxy): Promise<ResolvedOutlineItem[]> {
  const outline = await pdf.getOutline();
  if (!outline) return [];

  const resolveItems = async (items: typeof outline): Promise<ResolvedOutlineItem[]> => {
    const resolved = await Promise.all(items.map(async (item) => {
      const children = await resolveItems(item.items);
      const page = item.dest ? await destinationPage(pdf, item.dest) : null;
      if (page === null) return children;

      return [{
        title: item.title,
        page,
        children,
      }];
    }));

    return resolved.flat();
  };

  return resolveItems(outline);
}
