import { useEffect, useReducer } from "react";
import type { CitationSource } from "../lib/citations";
import type { PdfSource } from "../types";

/** Markdown for every LLM answer in the app: Chat, PDF, Research, Deep-dive,
 *  Coding chat, the assistant bubble.
 *
 *  The renderer (react-markdown + GFM + KaTeX, ~300 KB) lives in its own
 *  chunk. It is fetched when the browser is idle after this module loads, so
 *  by the time a reply arrives it is normally ready and renders in one pass;
 *  until then the text shows as plain, readable text. */

type RendererModule = typeof import("./MarkdownRenderer");

let renderer: RendererModule | null = null;
let loading: Promise<RendererModule> | null = null;

export function preloadMarkdown(): Promise<RendererModule> {
  loading ??= import("./MarkdownRenderer").then(mod => (renderer = mod));
  return loading;
}

if (typeof window !== "undefined") {
  const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
  idle(() => { void preloadMarkdown(); });
}

interface MarkdownProps {
  text: string;
  /** Sources that `[n]` markers in `text` refer to (research answers). */
  citations?: CitationSource[];
  /** Pages that `[Tr.N]` markers refer to (PDF answers), and how to open one. */
  pageSources?: PdfSource[];
  onOpenPage?: (source: PdfSource) => void;
}

export function Markdown({ text, citations, pageSources, onOpenPage }: MarkdownProps) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!renderer) void preloadMarkdown().then(rerender);
  }, []);

  if (renderer) {
    return (
      <renderer.MarkdownRenderer text={text} citations={citations} pageSources={pageSources} onOpenPage={onOpenPage} />
    );
  }
  return <div className="md md-plain">{text}</div>;
}
