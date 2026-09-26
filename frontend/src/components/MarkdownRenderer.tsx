import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { CitationChip } from "./CitationChip";
import { CopyButton } from "./CopyButton";
import { HighlightedCode } from "./HighlightedCode";
import { domainOf, linkCitations, linkPageCitations, safeHref, type CitationSource } from "../lib/citations";
import { normalizeMath } from "../lib/markdownMath";
import type { PdfSource } from "../types";

/** The heavy half of <Markdown>: react-markdown + GFM + KaTeX. Loaded as its
 *  own chunk (see Markdown.tsx) so the landing page and first paint of /chat
 *  don't pay for it.
 *
 *  Raw HTML in model output is never rendered (react-markdown ignores it
 *  unless rehype-raw is added — don't add it), and link URLs go through
 *  react-markdown's default transform, which drops `javascript:` and other
 *  unsafe schemes. */

interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

function hastText(node: HastNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(hastText).join("");
}

function codeLanguage(code: HastNode | undefined): string {
  const classes = code?.properties?.className;
  const list = Array.isArray(classes) ? classes.map(String) : [];
  return list.find(c => c.startsWith("language-"))?.slice("language-".length) ?? "";
}

function FencedCode({ code, language }: { code: string; language: string }) {
  return (
    <div className="md-code">
      <div className="md-code-head">
        <span className="md-code-lang">{language || "code"}</span>
        <CopyButton text={code} className="md-code-copy" />
      </div>
      <pre className="md-pre" data-lang={language || undefined}>
        <code><HighlightedCode code={code} language={language} /></code>
      </pre>
    </div>
  );
}

interface CitationContext {
  /** Research: sources that `[n]` markers refer to. */
  citations?: CitationSource[];
  /** PDF: pages the answer drew on, and how to open one. */
  pageSources?: PdfSource[];
  onOpenPage?: (source: PdfSource) => void;
}

function renderCitation(href: string, ctx: CitationContext) {
  // `[n]` and `[Tr.N]` were rewritten to `#cite-n` / `#page-N` links by
  // linkCitations / linkPageCitations before parsing.
  const cite = /^#cite-(\d+)$/.exec(href);
  const reference = cite && ctx.citations?.[Number(cite[1]) - 1];
  if (cite && reference) {
    const n = Number(cite[1]);
    const title = reference.title || reference.url;
    const link = safeHref(reference.url);
    return (
      <CitationChip
        label={String(n)}
        name={`Nguồn ${n}: ${title}`}
        meta={[reference.source, link ? domainOf(link) : ""].filter(Boolean).join(" · ")}
        title={title}
        snippet={reference.snippet}
        href={link}
      />
    );
  }
  const page = /^#page-(\d+)$/.exec(href);
  const pageSource = page && ctx.pageSources?.find(s => s.page === Number(page[1]));
  if (page && pageSource) {
    const { onOpenPage } = ctx;
    return (
      <CitationChip
        label={`tr.${pageSource.page}`}
        name={`Mở trang ${pageSource.page} trong tài liệu`}
        meta="Trong tài liệu"
        title={`Trang ${pageSource.page}`}
        snippet={pageSource.excerpt}
        onOpen={onOpenPage ? () => onOpenPage(pageSource) : undefined}
      />
    );
  }
  return null;
}

function buildComponents(ctx: CitationContext): Components {
  return {
    // Block code is `pre > code` in the HTML tree; render it here from the
    // source text so inline `code` keeps the default rendering.
    pre: ({ node }) => {
      const code = (node as HastNode | undefined)?.children?.find(c => c.tagName === "code");
      // mdast→hast appends one "\n" to every code block's text.
      return <FencedCode code={hastText(code).replace(/\n$/, "")} language={codeLanguage(code)} />;
    },
    a: ({ node: _node, ...props }) =>
      renderCitation(props.href ?? "", ctx) ?? <a {...props} target="_blank" rel="noopener noreferrer" />,
    table: ({ node: _node, ...props }) => (
      <div className="md-table-wrap"><table {...props} /></div>
    ),
  };
}

const plainComponents = buildComponents({});

// remark-breaks: a single newline stays a line break, as in the old
// renderer — models lay out steps and short lists that way.
const remarkPlugins = [remarkGfm, remarkBreaks, [remarkMath, { singleDollarTextMath: false }]] as const;
const rehypePlugins = [[rehypeKatex, { throwOnError: false, strict: "ignore" }]] as const;

interface MarkdownRendererProps extends CitationContext {
  text: string;
}

export function MarkdownRenderer({ text, citations, pageSources, onOpenPage }: MarkdownRendererProps) {
  const components = useMemo(
    () => (citations?.length || pageSources?.length
      ? buildComponents({ citations, pageSources, onOpenPage })
      : plainComponents),
    [citations, pageSources, onOpenPage],
  );
  const source = linkPageCitations(
    linkCitations(normalizeMath(text), citations?.length ?? 0),
    (pageSources ?? []).map(s => s.page),
  );

  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={remarkPlugins as never}
        rehypePlugins={rehypePlugins as never}
        components={components}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
