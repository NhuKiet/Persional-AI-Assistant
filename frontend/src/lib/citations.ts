import { mapOutsideCode } from "./markdownProse";

/** One entry of a research result's `references`, as `[n]` points at it. */
export interface CitationSource {
  title?: string;
  url: string;
  source: string;
  snippet?: string;
}

// `[n]` not preceded by a word character (`a[2]` is indexing) and not
// followed by "(" (`[2](https://…)` is already a link). Same rule as the
// backend's citations.py, so both sides agree on what counts as a marker.
const MARKER = /(?<!\w)\[(\d{1,3})\](?!\()/g;

/** Turn in-range `[n]` markers into `[n](#cite-n)` links for the renderer to
 *  draw as citation chips. The backend numbers sources so that `[n]` means
 *  references[n - 1]; anything past `count` (or everything, while the
 *  references haven't arrived yet mid-stream) stays plain text. Code is
 *  never touched. */
export function linkCitations(text: string, count: number): string {
  if (count < 1 || !text.includes("[")) return text;
  return mapOutsideCode(text, (prose) =>
    prose.replace(MARKER, (marker, digits: string) => {
      const n = Number(digits);
      return n >= 1 && n <= count ? `[${n}](#cite-${n})` : marker;
    }),
  );
}

// `[Tr.12]` as the PDF prompt asks, plus the variants models drift into:
// `[tr. 12]`, `[Trang 12]`, any capitalisation.
const PAGE_MARKER = /(?<!\w)\[(?:tr|trang)\.?\s*(\d{1,4})\](?!\()/gi;

/** Turn `[Tr.N]` page citations in a PDF answer into `[tr.N](#page-N)` links,
 *  for the pages the answer was given (`pages`, from the `sources` event).
 *  A page outside that list was never shown to the model — most likely a
 *  made-up number — so it stays plain text rather than jumping somewhere. */
export function linkPageCitations(text: string, pages: number[]): string {
  if (!pages.length || !text.includes("[")) return text;
  const known = new Set(pages);
  return mapOutsideCode(text, (prose) =>
    prose.replace(PAGE_MARKER, (marker, digits: string) => {
      const page = Number(digits);
      return known.has(page) ? `[tr.${page}](#page-${page})` : marker;
    }),
  );
}

/** A reference URL that is safe to put in an href: http(s) only. Sources
 *  come from search results and RSS, which can carry `javascript:` links. */
export function safeHref(url: string | undefined): string | undefined {
  const trimmed = url?.trim() ?? "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : undefined;
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
