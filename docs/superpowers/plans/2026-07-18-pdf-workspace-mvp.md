# PDF Workspace MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 50/50 PDF/chat split with a reading-first, three-column PDF workspace that provides real document navigation, search, collapsible support panels, and backend-authoritative source links.

**Architecture:** Keep `PdfPage` as the route-level owner of upload, model, session, and network state. Move reading behavior into focused PDF components coordinated by `PdfWorkspace`, expose an imperative `PdfViewerHandle` for navigation, and emit retrieved chunks as a dedicated SSE `sources` event before model tokens. Frontend source chips navigate through the viewer handle and fall back safely when exact text matching is unavailable.

**Tech Stack:** Python 3, FastAPI, pytest, React 18, TypeScript, `react-pdf` 9, PDF.js, Vitest, Testing Library, hand-written CSS.

## Global Constraints

- Preserve upload, delete/change-file, continuous rendering, text selection, `Alt + drag` image crop, context pins, streaming chat, summarization, model selection, session history, microphone input, and the image-pin vision guard.
- Remove the draggable 50/50 divider; outline and assistant widths are not user-resizable in this MVP.
- Use PDF.js page count as the canonical viewer page count after document load.
- Use actual PDF outline data; do not synthesize headings with AI.
- Search is case-insensitive but remains accent-sensitive for Vietnamese.
- Source metadata must come from retrieved `PDFChunk` objects, never from model-authored page numbers.
- Emit at most five deduplicated sources and preserve retrieval relevance order.
- Guarantee page navigation and truthful excerpts; exact sentence coordinates are not guaranteed.
- Do not add OCR, thumbnails, two-page mode, glossary extraction, saved PDF annotations, collaboration, or panel resizing.
- Use existing CSS tokens, especially `var(--accent-pdf)`, and preserve the import order in `frontend/src/styles.css`.
- Before editing CSS during execution, read `.agents/skills/css-architecture/SKILL.md`; before adding transitions or overlay motion, read `.agents/skills/ui-motion/SKILL.md`.
- Every implementation task follows red-green-refactor TDD and ends with a focused commit.

---

## File Map

### Backend

- Create `backend/app/features/pdf/sources.py`: serialize retrieved chunks into bounded, deduplicated source payloads.
- Modify `backend/app/features/pdf/processor.py`: allow context construction from an already-retrieved chunk list.
- Modify `backend/app/features/pdf/service.py`: retrieve once, emit sources, then stream tokens using the same chunks.
- Create `tests/test_pdf_sources.py`: pure serializer and SSE ordering coverage.
- Modify `tests/test_pdf_wiring.py`: retain router-level SSE contract coverage.

### Frontend

- Modify `frontend/src/types.ts`: add `PdfSource` and optional sources on `ChatMessage`.
- Create `frontend/src/lib/pdfStreamState.ts`: pure application of `sources` and `token` events to the active message.
- Create `frontend/src/components/pdf/SourceChips.tsx`: render source buttons.
- Create `frontend/src/components/pdf/PdfMessage.tsx`: compose the existing message bubble with source chips.
- Modify `frontend/src/components/pdf/PdfViewer.tsx`: expose navigation, zoom, fit-width, outline, search-index, and current-page callbacks.
- Create `frontend/src/components/pdf/pdfDocument.ts`: pure outline, search-index, and excerpt-matching helpers.
- Create `frontend/src/components/pdf/PdfOutline.tsx`: outline tree and page-list fallback.
- Create `frontend/src/components/pdf/PdfSearch.tsx`: search UI and result navigation.
- Create `frontend/src/components/pdf/PdfToolbar.tsx`: navigation, zoom, fit-width, search, file, and panel controls.
- Create `frontend/src/components/pdf/usePdfLayout.ts`: responsive panel-state rules and persistence.
- Create `frontend/src/components/pdf/PdfWorkspace.tsx`: semantic desktop/drawer/overlay shell.
- Create `frontend/src/components/pdf/PdfAssistantPanel.tsx`: extract current PDF chat panel UI.
- Modify `frontend/src/pages/PdfPage.tsx`: remove split-drag state and integrate the workspace components.
- Modify `frontend/src/styles/pdf.css`: PDF workspace component styling.
- Modify `frontend/src/styles/pdf-select.css`: replace PDF accent hardcodes with `var(--accent-pdf)`.
- Modify `frontend/src/styles/responsive.css`: 1280 px, 900–1279 px, and below-900 px workspace rules.
- Modify `frontend/src/test/setup.js`: add `IntersectionObserver` test shim only if component tests require it.
- Create focused test files beside the new PDF components and helpers.

---

### Task 1: Backend-Authoritative Source Events

**Files:**
- Create: `backend/app/features/pdf/sources.py`
- Modify: `backend/app/features/pdf/processor.py`
- Modify: `backend/app/features/pdf/service.py`
- Create: `tests/test_pdf_sources.py`
- Modify: `tests/test_pdf_wiring.py`

**Interfaces:**
- Consumes: `PDFChunk(page: int, index: int, text: str, score: float)` from `processor.py`.
- Produces: `serialize_sources(chunks: list[PDFChunk], limit: int = 5, excerpt_chars: int = 180) -> list[dict]`.
- Produces: `PDFProcessor.build_context_from_chunks(doc: PDFDocument, chunks: list[PDFChunk]) -> str`.
- Produces SSE event: `{"type": "sources", "sources": list[dict]}` before the first `token` event.

- [ ] **Step 1: Write failing serializer tests**

```python
# tests/test_pdf_sources.py
from backend.app.features.pdf.processor import PDFChunk
from backend.app.features.pdf.sources import serialize_sources


def test_serialize_sources_preserves_relevance_order_and_deduplicates():
    chunks = [
        PDFChunk(page=8, index=2, text="first relevant passage"),
        PDFChunk(page=3, index=0, text="second relevant passage"),
        PDFChunk(page=8, index=2, text="duplicate passage"),
    ]

    assert serialize_sources(chunks) == [
        {"page": 8, "chunk_index": 2, "excerpt": "first relevant passage"},
        {"page": 3, "chunk_index": 0, "excerpt": "second relevant passage"},
    ]


def test_serialize_sources_limits_count_and_excerpt_length():
    chunks = [PDFChunk(page=i + 1, index=0, text="x" * 240) for i in range(8)]
    sources = serialize_sources(chunks, limit=5, excerpt_chars=20)

    assert len(sources) == 5
    assert all(len(source["excerpt"]) <= 20 for source in sources)
```

- [ ] **Step 2: Run the serializer tests and confirm red**

Run: `pytest tests/test_pdf_sources.py -q`

Expected: collection fails because `backend.app.features.pdf.sources` does not exist.

- [ ] **Step 3: Implement the pure serializer**

```python
# backend/app/features/pdf/sources.py
from __future__ import annotations

from backend.app.features.pdf.processor import PDFChunk

__all__ = ["serialize_sources"]


def _excerpt(text: str, limit: int) -> str:
    compact = " ".join(text.split())
    if len(compact) <= limit:
        return compact
    return compact[: max(0, limit - 1)].rstrip() + "…"


def serialize_sources(
    chunks: list[PDFChunk],
    limit: int = 5,
    excerpt_chars: int = 180,
) -> list[dict]:
    sources: list[dict] = []
    seen: set[tuple[int, int]] = set()
    for chunk in chunks:
        key = (chunk.page, chunk.index)
        if key in seen:
            continue
        seen.add(key)
        sources.append({
            "page": chunk.page,
            "chunk_index": chunk.index,
            "excerpt": _excerpt(chunk.text, excerpt_chars),
        })
        if len(sources) == limit:
            break
    return sources
```

- [ ] **Step 4: Add failing tests for one retrieval and event ordering**

```python
# append to tests/test_pdf_sources.py
import pytest

from backend.app.features.pdf.processor import PDFDocument
from backend.app.features.pdf.schemas import PDFChatRequest
from backend.app.features.pdf.service import PdfService


@pytest.mark.asyncio
async def test_chat_emits_retrieved_sources_before_tokens(monkeypatch):
    chunks = [PDFChunk(page=4, index=1, text="authoritative excerpt")]
    document = PDFDocument("doc.pdf", total_pages=4, total_chars=21, chunks=chunks)
    service = PdfService()
    retrieve_calls = []

    monkeypatch.setattr(service, "_get_doc", lambda filename: document)

    def fake_retrieve(doc, query):
        retrieve_calls.append((doc, query))
        return chunks

    monkeypatch.setattr(service._processor, "retrieve", fake_retrieve)
    monkeypatch.setattr(service, "_stream_llm", lambda *args, **kwargs: iter(["answer"]))

    request = PDFChatRequest(message="question", filename="doc.pdf", session_id="s1")
    events = [event async for event in service.chat_events(request, "system")]

    assert len(retrieve_calls) == 1
    assert events[0] == {
        "type": "sources",
        "sources": [{"page": 4, "chunk_index": 1, "excerpt": "authoritative excerpt"}],
    }
    assert events[1] == {"type": "token", "content": "answer"}
    assert events[-1] == {"type": "done", "message": "ok"}
```

- [ ] **Step 5: Refactor context construction to accept retrieved chunks**

Add this method and keep the old public method delegating to it:

```python
# backend/app/features/pdf/processor.py, inside PDFProcessor
def build_context_from_chunks(self, doc: PDFDocument, chunks: list[PDFChunk]) -> str:
    ordered = sorted(chunks, key=lambda chunk: (chunk.page, chunk.index))
    parts = [f"[Tài liệu: {doc.filename} — {doc.total_pages} trang]\n"]
    total = len(parts[0])
    for chunk in ordered:
        snippet = f"\n--- Trang {chunk.page} ---\n{chunk.text}\n"
        if total + len(snippet) > MAX_CONTEXT:
            break
        parts.append(snippet)
        total += len(snippet)
    return "".join(parts)

def build_context(self, doc: PDFDocument, query: str) -> str:
    return self.build_context_from_chunks(doc, self.retrieve(doc, query))
```

- [ ] **Step 6: Retrieve once and emit sources before streaming**

In `PdfService.chat_events.run`, replace the current context construction with:

```python
document = self._get_doc(request.filename)
retrieved = self._processor.retrieve(document, request.message)
sources = serialize_sources(retrieved)
if sources:
    loop.call_soon_threadsafe(
        queue.put_nowait,
        {"type": "sources", "sources": sources},
    )
context = self._processor.build_context_from_chunks(document, retrieved)
content = build_multimodal_content(request.message, context, request.pins)
```

Add the import:

```python
from backend.app.features.pdf.sources import serialize_sources
```

Also make the existing missing-file event machine-readable while preserving its Vietnamese message:

```python
{
    "type": "error",
    "code": "pdf_not_found",
    "message": f"File '{request.filename}' không tìm thấy. Upload lại nhé.",
}
```

- [ ] **Step 7: Run backend PDF tests**

Run: `pytest tests/test_pdf_sources.py tests/test_pdf_context.py tests/test_pdf_service.py tests/test_pdf_wiring.py -q`

Expected: all selected tests pass and the new ordering test observes `sources` before `token`.

- [ ] **Step 8: Commit the backend source contract**

```bash
git add backend/app/features/pdf/sources.py backend/app/features/pdf/processor.py backend/app/features/pdf/service.py tests/test_pdf_sources.py tests/test_pdf_wiring.py
git commit -m "feat: stream authoritative PDF sources"
```

---

### Task 2: Frontend Source State and Source Chips

**Files:**
- Modify: `frontend/src/types.ts`
- Create: `frontend/src/lib/pdfStreamState.ts`
- Create: `frontend/src/lib/pdfStreamState.test.ts`
- Create: `frontend/src/components/pdf/SourceChips.tsx`
- Create: `frontend/src/components/pdf/SourceChips.test.tsx`
- Create: `frontend/src/components/pdf/PdfMessage.tsx`

**Interfaces:**
- Consumes: SSE `sources` and `token` events from Task 1.
- Produces: `PdfSource`, `PdfStreamEvent`, and `applyPdfStreamEvent`.
- Produces: `SourceChips({ sources, onOpenSource })`.

- [ ] **Step 1: Write failing state-transition tests**

```typescript
// frontend/src/lib/pdfStreamState.test.ts
import { describe, expect, it } from "vitest";
import { applyPdfStreamEvent } from "./pdfStreamState";
import type { ChatMessage } from "../types";

describe("applyPdfStreamEvent", () => {
  const initial: ChatMessage[] = [{ role: "assistant", content: "", id: 9 }];

  it("attaches sources to the active assistant message", () => {
    const next = applyPdfStreamEvent(initial, 9, {
      type: "sources",
      sources: [{ page: 15, chunk_index: 2, excerpt: "Embeddings" }],
    });
    expect(next[0].sources).toEqual([
      { page: 15, chunk_index: 2, excerpt: "Embeddings" },
    ]);
  });

  it("appends token content without dropping sources", () => {
    const withSources = applyPdfStreamEvent(initial, 9, {
      type: "sources",
      sources: [{ page: 15, chunk_index: 2, excerpt: "Embeddings" }],
    });
    const next = applyPdfStreamEvent(withSources, 9, { type: "token", content: "Answer" });
    expect(next[0].content).toBe("Answer");
    expect(next[0].sources).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the state tests and confirm red**

Run: `npm test -- --run src/lib/pdfStreamState.test.ts`

Workdir: `frontend`

Expected: the module or exported function is missing.

- [ ] **Step 3: Add source types and the pure reducer**

```typescript
// frontend/src/types.ts
export interface PdfSource {
  page: number;
  chunk_index: number;
  excerpt: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  id: number;
  sources?: PdfSource[];
}
```

```typescript
// frontend/src/lib/pdfStreamState.ts
import type { ChatMessage, PdfSource } from "../types";

export type PdfStreamEvent =
  | { type: "sources"; sources: PdfSource[] }
  | { type: "token"; content: string }
  | { type: "error"; message: string; code?: "pdf_not_found" }
  | { type: "done"; message: string };

export function applyPdfStreamEvent(
  messages: ChatMessage[],
  assistantId: number,
  event: PdfStreamEvent,
): ChatMessage[] {
  if (event.type === "done") return messages;
  return messages.map((message) => {
    if (message.id !== assistantId) return message;
    if (event.type === "sources") return { ...message, sources: event.sources };
    if (event.type === "token") return { ...message, content: message.content + event.content };
    const prefix = message.content ? `${message.content}\n\n` : "";
    return { ...message, content: `${prefix}⚠️ ${event.message}` };
  });
}
```

- [ ] **Step 4: Write and run failing SourceChips interaction test**

```tsx
// frontend/src/components/pdf/SourceChips.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import SourceChips from "./SourceChips";

it("labels sources by display order and opens the selected source", async () => {
  const onOpenSource = vi.fn();
  const source = { page: 15, chunk_index: 7, excerpt: "Embeddings" };
  render(<SourceChips sources={[source]} onOpenSource={onOpenSource} />);

  await userEvent.click(screen.getByRole("button", { name: "Trang 15 · Nguồn 1" }));
  expect(onOpenSource).toHaveBeenCalledWith(source);
});
```

Run: `npm test -- --run src/components/pdf/SourceChips.test.tsx`

Workdir: `frontend`

Expected: component import fails.

- [ ] **Step 5: Implement source chips and PDF message composition**

```tsx
// frontend/src/components/pdf/SourceChips.tsx
import type { PdfSource } from "../../types";

interface SourceChipsProps {
  sources: PdfSource[];
  onOpenSource: (source: PdfSource) => void;
}

export default function SourceChips({ sources, onOpenSource }: SourceChipsProps) {
  if (!sources.length) return null;
  return (
    <div className="pdf-source-chips" aria-label="Nguồn trong tài liệu">
      {sources.map((source, index) => (
        <button
          className="pdf-source-chip"
          key={`${source.page}:${source.chunk_index}`}
          onClick={() => onOpenSource(source)}
          title={source.excerpt}
        >
          Trang {source.page} · Nguồn {index + 1}
        </button>
      ))}
    </div>
  );
}
```

```tsx
// frontend/src/components/pdf/PdfMessage.tsx
import { Message } from "../Message";
import type { ChatMessage, PdfSource } from "../../types";
import SourceChips from "./SourceChips";

interface PdfMessageProps {
  message: ChatMessage;
  accentColor: string;
  onOpenSource: (source: PdfSource) => void;
}

export default function PdfMessage({ message, accentColor, onOpenSource }: PdfMessageProps) {
  return (
    <div className="pdf-message">
      <Message msg={message} accentColor={accentColor} />
      {message.role === "assistant" && message.sources?.length ? (
        <SourceChips sources={message.sources} onOpenSource={onOpenSource} />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 6: Run focused frontend tests and typecheck**

Run: `npm test -- --run src/lib/pdfStreamState.test.ts src/components/pdf/SourceChips.test.tsx && npm run typecheck`

Workdir: `frontend`

Expected: both test files pass and TypeScript exits successfully.

- [ ] **Step 7: Commit the frontend source contract**

```bash
git add frontend/src/types.ts frontend/src/lib/pdfStreamState.ts frontend/src/lib/pdfStreamState.test.ts frontend/src/components/pdf/SourceChips.tsx frontend/src/components/pdf/SourceChips.test.tsx frontend/src/components/pdf/PdfMessage.tsx
git commit -m "feat: render PDF source chips"
```

---

### Task 3: PDF Document Helpers and Viewer Controller

**Files:**
- Create: `frontend/src/components/pdf/pdfDocument.ts`
- Create: `frontend/src/components/pdf/pdfDocument.test.ts`
- Modify: `frontend/src/components/pdf/PdfViewer.tsx`
- Create: `frontend/src/components/pdf/PdfViewer.test.tsx`
- Modify: `frontend/src/test/setup.js`

**Interfaces:**
- Produces: `PdfViewerHandle.scrollToPage(page: number)`, `zoomIn()`, `zoomOut()`, `fitWidth()`, and `highlightExcerpt(page: number, excerpt: string)`.
- Produces callbacks: `onDocumentReady`, `onCurrentPageChange`, and `onSearchIndexReady`.
- Produces pure helpers: `clampPage`, `normalizeSearchText`, `findExcerptRange`, and `buildPdfSearchPages`.

- [ ] **Step 1: Write failing pure-helper tests**

```typescript
// frontend/src/components/pdf/pdfDocument.test.ts
import { describe, expect, it } from "vitest";
import { buildPdfSearchPages, clampPage, findExcerptRange, normalizeSearchText } from "./pdfDocument";

describe("PDF document helpers", () => {
  it("clamps navigation to the loaded page range", () => {
    expect(clampPage(0, 12)).toBe(1);
    expect(clampPage(7, 12)).toBe(7);
    expect(clampPage(99, 12)).toBe(12);
  });

  it("normalizes case and whitespace without stripping accents", () => {
    expect(normalizeSearchText("  Dữ liệu\nLỚN ")).toBe("dữ liệu lớn");
  });

  it("returns the matching range for an excerpt", () => {
    expect(findExcerptRange("Alpha Embeddings Omega", "embeddings")).toEqual({ start: 6, end: 16 });
  });

  it("builds canonical searchable page text from PDF.js", async () => {
    const pdf = {
      numPages: 1,
      getPage: async () => ({ getTextContent: async () => ({ items: [{ str: "Dữ liệu" }, { str: "lớn" }] }) }),
    };
    await expect(buildPdfSearchPages(pdf as never)).resolves.toEqual([{ page: 1, text: "Dữ liệu lớn" }]);
  });
});
```

- [ ] **Step 2: Run helper tests and confirm red**

Run: `npm test -- --run src/components/pdf/pdfDocument.test.ts`

Workdir: `frontend`

Expected: module import fails.

- [ ] **Step 3: Implement the pure helpers and viewer interface**

```typescript
// frontend/src/components/pdf/pdfDocument.ts
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
```

Add these exported types above the component in `PdfViewer.tsx`:

```typescript
export interface PdfViewerHandle {
  scrollToPage(page: number): void;
  zoomIn(): void;
  zoomOut(): void;
  fitWidth(): void;
  highlightExcerpt(page: number, excerpt: string): void;
}
```

- [ ] **Step 4: Write a failing imperative-navigation test**

```tsx
// frontend/src/components/pdf/PdfViewer.test.tsx
import { createRef } from "react";
import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import PdfViewer, { type PdfViewerHandle } from "./PdfViewer";

it("scrolls to the clamped page through its public handle", () => {
  const ref = createRef<PdfViewerHandle>();
  const scrollIntoView = vi.fn();
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(scrollIntoView);

  const { container } = render(<PdfViewer ref={ref} file="/doc.pdf" />);
  const page = document.createElement("div");
  page.dataset.pageNumber = "1";
  container.querySelector(".pdf-viewer")?.appendChild(page);

  ref.current?.scrollToPage(1);
  expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
});
```

Run: `npm test -- --run src/components/pdf/PdfViewer.test.tsx`

Workdir: `frontend`

Expected: the component does not accept a ref and exposes no viewer handle.

- [ ] **Step 5: Convert PdfViewer to `forwardRef` and add navigation state**

Use these props and public-handle rules in `PdfViewer.tsx`:

```typescript
interface PdfViewerProps {
  file: string;
  onCanvasReady?: (pageNum: number, canvas: HTMLCanvasElement) => void;
  onDocumentReady?: (pdf: PDFDocumentProxy, totalPages: number) => void;
  onDocumentError?: (error: Error) => void;
  onCurrentPageChange?: (page: number) => void;
  onSearchIndexReady?: (pages: PdfSearchPage[]) => void;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;
const SCALE_STEP = 0.15;
```

Inside the component, expose the handle with:

```typescript
useImperativeHandle(ref, () => ({
  scrollToPage(page) {
    const target = hostRef.current?.querySelector<HTMLElement>(
      `[data-page-number="${clampPage(page, numPages)}"]`,
    );
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  },
  zoomIn() {
    setManualScale((value) => Math.min(MAX_SCALE, value + SCALE_STEP));
    setViewMode("manual");
  },
  zoomOut() {
    setManualScale((value) => Math.max(MIN_SCALE, value - SCALE_STEP));
    setViewMode("manual");
  },
  fitWidth() {
    setViewMode("fit-width");
  },
  highlightExcerpt(page, excerpt) {
    setSourceHighlight({ page, excerpt, key: Date.now() });
    const target = hostRef.current?.querySelector<HTMLElement>(`[data-page-number="${page}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  },
}), [numPages]);
```

Use `IntersectionObserver` on `.pdf-page-wrap` elements. Choose the visible page with the largest `intersectionRatio` and call `onCurrentPageChange(page)` only when it changes. On document load, call `onDocumentReady(pdf, pdf.numPages)` and call `buildPdfSearchPages(pdf).then(onSearchIndexReady)`.

On `Document` load failure, store the error for the existing fallback UI and call `onDocumentError(error)`; the parent must not discard chat state for a generic rendering failure.

For excerpt highlighting, collect the page wrapper's `.textLayer span` elements, concatenate their text, use `findExcerptRange`, add `.pdf-source-highlight` to every span whose character interval overlaps the match, and remove the class after 4 seconds. If no match exists, add `.pdf-source-page-target` to the page wrapper for 4 seconds so page-level focus remains truthful.

- [ ] **Step 6: Add a deterministic IntersectionObserver shim if the test uses it**

```javascript
// frontend/src/test/setup.js
if (!global.IntersectionObserver) {
  global.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
```

- [ ] **Step 7: Run viewer tests, existing selection tests, and typecheck**

Run: `npm test -- --run src/components/pdf/pdfDocument.test.ts src/components/pdf/PdfViewer.test.tsx src/test/SelectionLayer.test.jsx && npm run typecheck`

Workdir: `frontend`

Expected: all focused tests pass and the existing selection interaction remains green.

- [ ] **Step 8: Commit the viewer controller**

```bash
git add frontend/src/components/pdf/pdfDocument.ts frontend/src/components/pdf/pdfDocument.test.ts frontend/src/components/pdf/PdfViewer.tsx frontend/src/components/pdf/PdfViewer.test.tsx frontend/src/test/setup.js
git commit -m "feat: add PDF viewer navigation controller"
```

---

### Task 4: Actual PDF Outline and Page Fallback

**Files:**
- Modify: `frontend/src/components/pdf/pdfDocument.ts`
- Modify: `frontend/src/components/pdf/pdfDocument.test.ts`
- Create: `frontend/src/components/pdf/PdfOutline.tsx`
- Create: `frontend/src/components/pdf/PdfOutline.test.tsx`

**Interfaces:**
- Consumes: `PDFDocumentProxy.getOutline()`, `getDestination()`, and `getPageIndex()`.
- Produces: `ResolvedOutlineItem { title, page, children }`.
- Produces: `resolvePdfOutline(pdf) -> Promise<ResolvedOutlineItem[]>`.
- Consumes: current page from `PdfViewer` and `onNavigate(page)` from the workspace.

- [ ] **Step 1: Write failing outline-resolution tests**

```typescript
// append to frontend/src/components/pdf/pdfDocument.test.ts
import { resolvePdfOutline } from "./pdfDocument";

it("resolves named and explicit destinations recursively", async () => {
  const pdf = {
    getOutline: async () => [{
      title: "Chapter",
      dest: "chapter",
      items: [{ title: "Section", dest: [{ num: 9, gen: 0 }], items: [] }],
    }],
    getDestination: async () => [{ num: 4, gen: 0 }],
    getPageIndex: async (ref: { num: number }) => ref.num,
  };

  await expect(resolvePdfOutline(pdf as never)).resolves.toEqual([{
    title: "Chapter",
    page: 5,
    children: [{ title: "Section", page: 10, children: [] }],
  }]);
});
```

- [ ] **Step 2: Run outline helper test and confirm red**

Run: `npm test -- --run src/components/pdf/pdfDocument.test.ts`

Workdir: `frontend`

Expected: `resolvePdfOutline` is missing.

- [ ] **Step 3: Implement recursive outline resolution**

```typescript
// append to frontend/src/components/pdf/pdfDocument.ts; reuse the top-level PDFDocumentProxy import from Task 3
export interface ResolvedOutlineItem {
  title: string;
  page: number;
  children: ResolvedOutlineItem[];
}

async function destinationPage(pdf: PDFDocumentProxy, dest: string | unknown[]): Promise<number | null> {
  try {
    const explicit = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
    if (!explicit?.length) return null;
    const pageRef = explicit[0];
    if (typeof pageRef === "number") return pageRef + 1;
    return (await pdf.getPageIndex(pageRef)) + 1;
  } catch {
    return null;
  }
}

export async function resolvePdfOutline(pdf: PDFDocumentProxy): Promise<ResolvedOutlineItem[]> {
  const outline = await pdf.getOutline();
  if (!outline) return [];
  const resolveItems = async (items: typeof outline): Promise<ResolvedOutlineItem[]> => {
    const resolved = await Promise.all(items.map(async (item) => {
      const page = item.dest ? await destinationPage(pdf, item.dest) : null;
      if (page === null) return null;
      return { title: item.title, page, children: await resolveItems(item.items) };
    }));
    return resolved.filter((item): item is ResolvedOutlineItem => item !== null);
  };
  return resolveItems(outline);
}
```

- [ ] **Step 4: Write failing component tests for outline and fallback**

```tsx
// frontend/src/components/pdf/PdfOutline.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import PdfOutline from "./PdfOutline";

it("navigates using the resolved outline", async () => {
  const onNavigate = vi.fn();
  render(<PdfOutline items={[{ title: "Chapter", page: 5, children: [] }]} totalPages={8} currentPage={5} onNavigate={onNavigate} />);
  await userEvent.click(screen.getByRole("button", { name: "Chapter" }));
  expect(onNavigate).toHaveBeenCalledWith(5);
  expect(screen.getByRole("button", { name: "Chapter" })).toHaveAttribute("aria-current", "page");
});

it("renders a flat page list when no outline exists", () => {
  render(<PdfOutline items={[]} totalPages={3} currentPage={1} onNavigate={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Trang 3" })).toBeInTheDocument();
});
```

- [ ] **Step 5: Implement the accessible outline tree**

`PdfOutline.tsx` must render nested `<ul>` elements, buttons for navigation, `aria-current="page"` on the nearest outline destination at or before `currentPage`, and a flat `Trang N` list when `items.length === 0`.

Use this active-page helper:

```typescript
function activeOutlinePage(items: ResolvedOutlineItem[], currentPage: number): number | null {
  const pages: number[] = [];
  const collect = (nodes: ResolvedOutlineItem[]) => nodes.forEach((node) => {
    pages.push(node.page);
    collect(node.children);
  });
  collect(items);
  return pages.filter((page) => page <= currentPage).sort((a, b) => b - a)[0] ?? null;
}
```

- [ ] **Step 6: Run outline tests and typecheck**

Run: `npm test -- --run src/components/pdf/pdfDocument.test.ts src/components/pdf/PdfOutline.test.tsx && npm run typecheck`

Workdir: `frontend`

Expected: outline resolution, navigation, active state, and page fallback pass.

- [ ] **Step 7: Commit outline navigation**

```bash
git add frontend/src/components/pdf/pdfDocument.ts frontend/src/components/pdf/pdfDocument.test.ts frontend/src/components/pdf/PdfOutline.tsx frontend/src/components/pdf/PdfOutline.test.tsx
git commit -m "feat: add PDF outline navigation"
```

---

### Task 5: Client-Side PDF Search

**Files:**
- Modify: `frontend/src/components/pdf/pdfDocument.ts`
- Modify: `frontend/src/components/pdf/pdfDocument.test.ts`
- Create: `frontend/src/components/pdf/PdfSearch.tsx`
- Create: `frontend/src/components/pdf/PdfSearch.test.tsx`

**Interfaces:**
- Consumes: `PdfSearchPage[]` built by the viewer.
- Produces: `searchPdfPages(pages, query) -> PdfSearchResult[]`.
- Produces: `PdfSearch({ pages, onOpenResult, onClose })`.

- [ ] **Step 1: Write failing search tests**

```typescript
// append to frontend/src/components/pdf/pdfDocument.test.ts
import { searchPdfPages } from "./pdfDocument";

it("searches case-insensitively while preserving accents", () => {
  const pages = [
    { page: 1, text: "Dữ liệu lớn và Embeddings" },
    { page: 2, text: "Du lieu khong dau" },
  ];
  expect(searchPdfPages(pages, "EMBEDDINGS")).toEqual([
    { page: 1, excerpt: "Dữ liệu lớn và Embeddings", matchText: "EMBEDDINGS", matchStart: 15, matchEnd: 25 },
  ]);
  expect(searchPdfPages(pages, "dữ liệu")).toHaveLength(1);
});
```

- [ ] **Step 2: Run search helper test and confirm red**

Run: `npm test -- --run src/components/pdf/pdfDocument.test.ts`

Workdir: `frontend`

Expected: `searchPdfPages` is missing.

- [ ] **Step 3: Implement deterministic search results**

```typescript
// append to frontend/src/components/pdf/pdfDocument.ts
export interface PdfSearchResult { page: number; excerpt: string; matchText: string; matchStart: number; matchEnd: number }

export function searchPdfPages(pages: PdfSearchPage[], query: string): PdfSearchResult[] {
  const needle = normalizeSearchText(query);
  if (!needle) return [];
  return pages.flatMap((page) => {
    const normalized = normalizeSearchText(page.text);
    const start = normalized.indexOf(needle);
    if (start < 0) return [];
    return [{ page: page.page, excerpt: page.text.slice(0, 180), matchText: query, matchStart: start, matchEnd: start + needle.length }];
  });
}
```

- [ ] **Step 4: Write failing UI tests for count and navigation**

```tsx
// frontend/src/components/pdf/PdfSearch.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import PdfSearch from "./PdfSearch";

it("shows result count and navigates to the next result", async () => {
  const onOpenResult = vi.fn();
  render(<PdfSearch pages={[{ page: 2, text: "Agent graph" }, { page: 7, text: "Agent memory" }]} onOpenResult={onOpenResult} onClose={vi.fn()} />);

  await userEvent.type(screen.getByRole("searchbox", { name: "Tìm trong PDF" }), "agent");
  expect(screen.getByText("1 / 2")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Kết quả tiếp theo" }));
  expect(onOpenResult).toHaveBeenLastCalledWith(expect.objectContaining({ page: 7 }));
});
```

- [ ] **Step 5: Implement PdfSearch**

The component owns `query`, `results`, and `activeIndex`. It recalculates with `searchPdfPages`, resets the index to zero on query change, calls `onOpenResult(results[activeIndex])`, exposes previous/next buttons, uses `role="searchbox"`, and renders `Không có văn bản để tìm kiếm` when `pages.length === 0`.

The next-result transition is:

```typescript
const openAt = (nextIndex: number) => {
  if (!results.length) return;
  const normalized = (nextIndex + results.length) % results.length;
  setActiveIndex(normalized);
  onOpenResult(results[normalized]);
};
```

- [ ] **Step 6: Run search tests and typecheck**

Run: `npm test -- --run src/components/pdf/pdfDocument.test.ts src/components/pdf/PdfSearch.test.tsx && npm run typecheck`

Workdir: `frontend`

Expected: search helper and search UI tests pass.

- [ ] **Step 7: Commit PDF search**

```bash
git add frontend/src/components/pdf/pdfDocument.ts frontend/src/components/pdf/pdfDocument.test.ts frontend/src/components/pdf/PdfSearch.tsx frontend/src/components/pdf/PdfSearch.test.tsx
git commit -m "feat: add client-side PDF search"
```

---

### Task 6: Responsive Panel State, Toolbar, and Workspace Shell

**Files:**
- Create: `frontend/src/components/pdf/usePdfLayout.ts`
- Create: `frontend/src/components/pdf/usePdfLayout.test.tsx`
- Create: `frontend/src/components/pdf/PdfToolbar.tsx`
- Create: `frontend/src/components/pdf/PdfToolbar.test.tsx`
- Create: `frontend/src/components/pdf/PdfWorkspace.tsx`
- Create: `frontend/src/components/pdf/PdfWorkspace.test.tsx`

**Interfaces:**
- Produces: `PdfLayoutMode = "desktop" | "laptop" | "narrow"` and `usePdfLayoutMode()`.
- Produces panel controls: `outlineOpen`, `assistantOpen`, `toggleOutline`, `toggleAssistant`, and `closeOverlays`.
- Consumes viewer actions and panel-state actions in `PdfToolbar`.
- Produces semantic regions in `PdfWorkspace`.

- [ ] **Step 1: Write failing layout-state tests**

```tsx
// frontend/src/components/pdf/usePdfLayout.test.tsx
import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { usePdfLayout } from "./usePdfLayout";

it("persists independently collapsible desktop panels", () => {
  const { result } = renderHook(() => usePdfLayout("desktop"));
  act(() => result.current.toggleOutline());
  expect(result.current.outlineOpen).toBe(false);
  expect(result.current.assistantOpen).toBe(true);
  expect(localStorage.getItem("pdf-outline-open")).toBe("false");
});

it("keeps narrow overlays mutually exclusive", () => {
  const { result } = renderHook(() => usePdfLayout("narrow"));
  act(() => result.current.toggleOutline());
  act(() => result.current.toggleAssistant());
  expect(result.current.outlineOpen).toBe(false);
  expect(result.current.assistantOpen).toBe(true);
});
```

- [ ] **Step 2: Run layout-hook tests and confirm red**

Run: `npm test -- --run src/components/pdf/usePdfLayout.test.tsx`

Workdir: `frontend`

Expected: hook import fails.

- [ ] **Step 3: Implement layout state**

```typescript
// frontend/src/components/pdf/usePdfLayout.ts
import { useEffect, useState } from "react";

export type PdfLayoutMode = "desktop" | "laptop" | "narrow";

export function usePdfLayoutMode(): PdfLayoutMode {
  const read = (): PdfLayoutMode => window.innerWidth < 900
    ? "narrow"
    : window.innerWidth < 1280
      ? "laptop"
      : "desktop";
  const [mode, setMode] = useState<PdfLayoutMode>(read);
  useEffect(() => {
    const onResize = () => setMode(read());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return mode;
}

const stored = (key: string, fallback: boolean) => {
  const value = localStorage.getItem(key);
  return value === null ? fallback : value === "true";
};

export function usePdfLayout(mode: PdfLayoutMode) {
  const [outlineOpen, setOutlineOpen] = useState(() => mode === "desktop" && stored("pdf-outline-open", true));
  const [assistantOpen, setAssistantOpen] = useState(() => mode !== "narrow" && stored("pdf-assistant-open", true));

  useEffect(() => {
    if (mode === "narrow" && outlineOpen && assistantOpen) setOutlineOpen(false);
  }, [mode, outlineOpen, assistantOpen]);

  const toggleOutline = () => setOutlineOpen((open) => {
    const next = !open;
    if (mode === "narrow" && next) setAssistantOpen(false);
    localStorage.setItem("pdf-outline-open", String(next));
    return next;
  });

  const toggleAssistant = () => setAssistantOpen((open) => {
    const next = !open;
    if (mode === "narrow" && next) setOutlineOpen(false);
    localStorage.setItem("pdf-assistant-open", String(next));
    return next;
  });

  return {
    outlineOpen,
    assistantOpen,
    toggleOutline,
    toggleAssistant,
    closeOverlays: () => { setOutlineOpen(false); setAssistantOpen(false); },
  };
}
```

- [ ] **Step 4: Write failing toolbar and workspace tests**

```tsx
// frontend/src/components/pdf/PdfToolbar.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import PdfToolbar from "./PdfToolbar";

it("clamps entered pages and exposes panel state", async () => {
  const onNavigate = vi.fn();
  render(<PdfToolbar filename="doc.pdf" currentPage={2} totalPages={5} outlineOpen assistantOpen onNavigate={onNavigate} onPrevious={vi.fn()} onNext={vi.fn()} onZoomIn={vi.fn()} onZoomOut={vi.fn()} onFitWidth={vi.fn()} onToggleSearch={vi.fn()} onToggleOutline={vi.fn()} onToggleAssistant={vi.fn()} onChangeFile={vi.fn()} />);
  const input = screen.getByRole("spinbutton", { name: "Trang hiện tại" });
  await userEvent.clear(input);
  await userEvent.type(input, "99{Enter}");
  expect(onNavigate).toHaveBeenCalledWith(5);
  expect(screen.getByRole("button", { name: "Ẩn mục lục" })).toHaveAttribute("aria-expanded", "true");
});
```

```tsx
// frontend/src/components/pdf/PdfWorkspace.test.tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import PdfWorkspace from "./PdfWorkspace";

it("exposes document, viewer, and assistant regions", () => {
  render(<PdfWorkspace mode="desktop" outlineOpen assistantOpen toolbar={<div>Toolbar</div>} outline={<div>Outline</div>} viewer={<div>Viewer</div>} assistant={<div>Assistant</div>} onCloseOverlays={() => {}} />);
  expect(screen.getByRole("navigation", { name: "Mục lục tài liệu" })).toBeInTheDocument();
  expect(screen.getByRole("main", { name: "Trình đọc PDF" })).toBeInTheDocument();
  expect(screen.getByRole("complementary", { name: "Trợ lý tài liệu" })).toBeInTheDocument();
});
```

- [ ] **Step 5: Implement PdfToolbar and PdfWorkspace**

`PdfToolbar` uses a local page-input string, submits through `clampPage`, and labels every icon-only button. `PdfWorkspace` renders the supplied slots with these stable classes and roles:

```tsx
<section className={`pdf-workspace pdf-workspace-${mode}`}>
  <div className="pdf-workspace-toolbar">{toolbar}</div>
  <div className="pdf-workspace-body">
    {outlineOpen ? <nav className="pdf-outline-panel" aria-label="Mục lục tài liệu">{outline}</nav> : null}
    <main className="pdf-viewer-panel" aria-label="Trình đọc PDF">{viewer}</main>
    {assistantOpen ? <aside className="pdf-assistant-panel" aria-label="Trợ lý tài liệu">{assistant}</aside> : null}
    {mode !== "desktop" && (outlineOpen || assistantOpen) ? (
      <button className="pdf-overlay-backdrop" aria-label="Đóng bảng đang mở" onClick={onCloseOverlays} />
    ) : null}
  </div>
</section>
```

On narrow mode, the overlay panel handles Escape and returns focus to the toolbar toggle that opened it.

Implement focus containment in `PdfWorkspace` with a ref around the active overlay:

```typescript
useEffect(() => {
  if (mode !== "narrow" || (!outlineOpen && !assistantOpen)) return;
  const previous = document.activeElement as HTMLElement | null;
  const panel = activeOverlayRef.current;
  const focusable = () => Array.from(panel?.querySelectorAll<HTMLElement>(
    'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
  ) ?? []).filter((element) => !element.hasAttribute("disabled"));
  focusable()[0]?.focus();
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCloseOverlays();
      previous?.focus();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusable();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener("keydown", onKeyDown);
  return () => document.removeEventListener("keydown", onKeyDown);
}, [mode, outlineOpen, assistantOpen, onCloseOverlays]);
```

- [ ] **Step 6: Run layout, toolbar, and workspace tests**

Run: `npm test -- --run src/components/pdf/usePdfLayout.test.tsx src/components/pdf/PdfToolbar.test.tsx src/components/pdf/PdfWorkspace.test.tsx && npm run typecheck`

Workdir: `frontend`

Expected: panel persistence, mutual exclusion, page clamping, and semantic region tests pass.

- [ ] **Step 7: Commit the workspace shell**

```bash
git add frontend/src/components/pdf/usePdfLayout.ts frontend/src/components/pdf/usePdfLayout.test.tsx frontend/src/components/pdf/PdfToolbar.tsx frontend/src/components/pdf/PdfToolbar.test.tsx frontend/src/components/pdf/PdfWorkspace.tsx frontend/src/components/pdf/PdfWorkspace.test.tsx
git commit -m "feat: add responsive PDF workspace shell"
```

---

### Task 7: Assistant Extraction and PdfPage Integration

**Files:**
- Create: `frontend/src/components/pdf/PdfAssistantPanel.tsx`
- Create: `frontend/src/components/pdf/PdfAssistantPanel.test.tsx`
- Modify: `frontend/src/pages/PdfPage.tsx`
- Modify: `frontend/src/test/routes.contract.test.jsx`

**Interfaces:**
- Consumes: existing file info, messages, pins, summary state, input state, model state, and send handlers from `PdfPage`.
- Consumes: `PdfViewerHandle`, resolved outline, search pages, `PdfLayoutMode`, and source click callbacks from Tasks 2–6.
- Produces: fully integrated PDF workspace with no split divider state.

- [ ] **Step 1: Write a failing assistant regression test**

```tsx
// frontend/src/components/pdf/PdfAssistantPanel.test.tsx
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import PdfAssistantPanel from "./PdfAssistantPanel";

it("preserves file information, summary, messages, pins, and input", () => {
  render(<PdfAssistantPanel filename="doc.pdf" totalPages={12} totalChars={3400} messages={[]} pins={[]} input="" streaming={false} summarizing={false} accentColor="#FF8C69" onInputChange={vi.fn()} onSend={vi.fn()} onSummarize={vi.fn()} onRemovePin={vi.fn()} onOpenSource={vi.fn()} />);
  expect(screen.getByText("doc.pdf")).toBeInTheDocument();
  expect(screen.getByText("12 trang · 3.4K ký tự")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Tóm tắt" })).toBeInTheDocument();
  expect(screen.getByPlaceholderText("Hỏi về nội dung PDF…")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the assistant test and confirm red**

Run: `npm test -- --run src/components/pdf/PdfAssistantPanel.test.tsx`

Workdir: `frontend`

Expected: component import fails.

- [ ] **Step 3: Extract the existing assistant UI without changing behavior**

Move the current file-info bar, `ContextPins`, empty suggestions, message list, microphone, textarea, and send button into `PdfAssistantPanel.tsx`. Replace message rendering with:

```tsx
{messages.map((message) => (
  <PdfMessage
    key={message.id}
    message={message}
    accentColor={accentColor}
    onOpenSource={onOpenSource}
  />
))}
```

Keep Enter-to-send behavior:

```typescript
const onInputKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    onSend(input);
  }
};
```

- [ ] **Step 4: Replace split state with workspace integration in PdfPage**

Delete `splitRatio`, `dragSplit`, `startSplitDrag`, the mousemove/mouseup split effect, `.pdf-divider`, and inline percentage widths.

Add state and refs:

```typescript
const viewerRef = useRef<PdfViewerHandle>(null);
const [pdfProxy, setPdfProxy] = useState<PDFDocumentProxy | null>(null);
const [totalPages, setTotalPages] = useState(0);
const [currentPage, setCurrentPage] = useState(1);
const [outline, setOutline] = useState<ResolvedOutlineItem[]>([]);
const [searchPages, setSearchPages] = useState<PdfSearchPage[]>([]);
const [searchOpen, setSearchOpen] = useState(false);
const layoutMode = usePdfLayoutMode();
const layout = usePdfLayout(layoutMode);
```

Collapse app history on entry:

```typescript
useEffect(() => {
  if (uploadedPDF) setSidebarOpen(false);
}, [uploadedPDF]);
```

Resolve outline when the PDF proxy changes:

```typescript
useEffect(() => {
  let cancelled = false;
  if (!pdfProxy) {
    setOutline([]);
    return;
  }
  resolvePdfOutline(pdfProxy).then((items) => {
    if (!cancelled) setOutline(items);
  }).catch(() => {
    if (!cancelled) setOutline([]);
  });
  return () => { cancelled = true; };
}, [pdfProxy]);
```

Apply every SSE event through `applyPdfStreamEvent`; do not handle `sources` inside the token branch:

```typescript
const event = JSON.parse(data) as PdfStreamEvent;
if (event.type === "error" && event.code === "pdf_not_found") {
  setUploadedPDF(null);
  setMessages([]);
  setPins([]);
  sessionId.current = SESSION_ID();
  return;
}
setMessages((current) => applyPdfStreamEvent(current, aiId, event));
```

Keep the pins used for a request until a `done` event arrives. Do not call `setPins([])` immediately after `fetch`; on `error` or connection loss leave the pins and user question visible so the same context can be retried.

Open a source through the viewer:

```typescript
const openSource = (source: PdfSource) => {
  if (layoutMode === "narrow" && layout.assistantOpen) layout.toggleAssistant();
  viewerRef.current?.highlightExcerpt(source.page, source.excerpt);
};
```

- [ ] **Step 5: Compose the approved workspace**

Use `PdfWorkspace` with:

- `PdfToolbar` in the toolbar slot.
- `PdfOutline` in the outline slot.
- `SelectionLayer > PdfViewer` in the viewer slot.
- `PdfAssistantPanel` in the assistant slot.
- `PdfSearch` anchored below the toolbar only when `searchOpen` is true.

Wire search navigation with `viewerRef.current?.highlightExcerpt(result.page, result.matchText)` so a successful match is highlighted and an unavailable text-layer match falls back to page focus.

Use `totalPages` from `onDocumentReady`, not `uploadedPDF.total_pages`, for toolbar navigation and page fallback after load.

Pass `onDocumentError` from `PdfViewer` to `PdfPage`. Generic render failures keep the assistant available with the existing viewer error; only the machine-readable `pdf_not_found` stream event exits the workspace and returns to upload.

- [ ] **Step 6: Extend route contract coverage**

Add assertions to the PDF route test that the uploaded state renders controls named `Mục lục`, `Hỏi tài liệu`, `Tìm trong PDF`, and no element with class `.pdf-divider`.

Run: `npm test -- --run src/components/pdf/PdfAssistantPanel.test.tsx src/test/routes.contract.test.jsx && npm run typecheck`

Workdir: `frontend`

Expected: assistant extraction and route integration tests pass; TypeScript exits successfully.

- [ ] **Step 7: Commit the integrated workspace**

```bash
git add frontend/src/components/pdf/PdfAssistantPanel.tsx frontend/src/components/pdf/PdfAssistantPanel.test.tsx frontend/src/pages/PdfPage.tsx frontend/src/test/routes.contract.test.jsx
git commit -m "feat: integrate reading-first PDF workspace"
```

---

### Task 8: Styling, Responsive Rules, Accessibility, and Final Regression

**Files:**
- Modify: `frontend/src/styles/pdf.css`
- Modify: `frontend/src/styles/pdf-select.css`
- Modify: `frontend/src/styles/responsive.css`
- Modify: focused PDF component tests when accessibility assertions require additions

**Interfaces:**
- Consumes: stable class names from Tasks 2–7.
- Produces: approved desktop, laptop, narrow, and focus-mode layouts.
- Produces: token-based focus, source, paper, drawer, overlay, and reduced-motion styles.

- [ ] **Step 1: Read required CSS and motion guidance**

Run:

```powershell
Get-Content -Raw .agents/skills/css-architecture/SKILL.md
Get-Content -Raw .agents/skills/ui-motion/SKILL.md
```

Expected: both instruction files are read before any CSS edit.

- [ ] **Step 2: Add a failing CSS contract test**

Create a focused Node/Vitest test that reads the CSS files and asserts the required tokens and breakpoints:

```typescript
// frontend/src/components/pdf/pdfStyles.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pdfCss = readFileSync(new URL("../../styles/pdf.css", import.meta.url), "utf8");
const responsiveCss = readFileSync(new URL("../../styles/responsive.css", import.meta.url), "utf8");

describe("PDF workspace CSS contract", () => {
  it("uses the PDF accent token and defines the approved responsive modes", () => {
    expect(pdfCss).toContain("var(--accent-pdf)");
    expect(pdfCss).toContain(".pdf-workspace");
    expect(responsiveCss).toContain("@media (max-width: 1279px)");
    expect(responsiveCss).toContain("@media (max-width: 899px)");
  });
});
```

Run: `npm test -- --run src/components/pdf/pdfStyles.test.ts`

Workdir: `frontend`

Expected: fails until workspace styles and breakpoints exist.

- [ ] **Step 3: Implement token-based workspace styles**

In `pdf.css`, remove old `.pdf-split`, `.pdf-pane-left`, `.pdf-pane-right`, `.pdf-divider`, `.resize-divider`, and `.resize-handle` rules that exist only for split resizing.

Add these structural rules using the exact design tokens:

```css
.pdf-workspace { height: calc(100dvh - 72px); min-height: 0; display: flex; flex-direction: column; }
.pdf-workspace-body { min-height: 0; flex: 1; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; position: relative; overflow: hidden; }
.pdf-outline-panel { width: 232px; border-right: 1px solid var(--border); background: var(--bg2); overflow: auto; }
.pdf-viewer-panel { min-width: 0; overflow: hidden; background: var(--bg3); }
.pdf-assistant-panel { width: 360px; border-left: 1px solid var(--border); background: var(--bg2); overflow: hidden; }
.pdf-viewer { height: 100%; overflow: auto; padding: 24px; }
.pdf-page-wrap { width: max-content; max-width: 100%; margin: 0 auto 20px; box-shadow: var(--shadow-2); }
.pdf-source-chip { border: 1px solid color-mix(in srgb, var(--accent-pdf) 45%, transparent); color: var(--accent-pdf); background: color-mix(in srgb, var(--accent-pdf) 8%, transparent); }
.pdf-source-chip:focus-visible { outline: 2px solid var(--accent-pdf); outline-offset: 2px; }
.pdf-source-highlight { background: color-mix(in srgb, var(--accent-pdf) 26%, transparent); }
.pdf-source-page-target { outline: 3px solid var(--accent-pdf); outline-offset: 4px; }
```

Use existing `--dur-*` and `--ease-*` tokens for panel opacity/transform only. Do not animate width, canvas scale, page position, `height`, or `left`.

- [ ] **Step 4: Add responsive rules in the existing responsive layer**

```css
/* frontend/src/styles/responsive.css */
@media (max-width: 1279px) {
  .pdf-workspace-laptop .pdf-outline-panel {
    position: absolute; inset: 0 auto 0 0; z-index: 30; box-shadow: var(--shadow-2);
  }
}

@media (max-width: 899px) {
  .pdf-assistant-panel,
  .pdf-outline-panel {
    position: absolute; inset: 0; z-index: 40; width: min(100%, 420px);
  }
  .pdf-assistant-panel { margin-left: auto; }
  .pdf-overlay-backdrop { position: absolute; inset: 0; z-index: 35; background: rgba(0, 0, 0, 0.55); border: 0; }
  .pdf-workspace-toolbar { overflow-x: auto; }
}

@media (prefers-reduced-motion: reduce) {
  .pdf-outline-panel,
  .pdf-assistant-panel,
  .pdf-source-highlight { transition-duration: 0.01ms !important; }
}
```

- [ ] **Step 5: Replace selection hardcodes with tokens**

In `pdf-select.css`, replace `#FF8C69` and equivalent coral rgba uses with `var(--accent-pdf)` or `color-mix(in srgb, var(--accent-pdf) N%, transparent)` while preserving contrast of button text and crop borders.

- [ ] **Step 6: Run the complete frontend verification suite**

Run: `npm test && npm run typecheck && npm run build`

Workdir: `frontend`

Expected: all Vitest tests pass, TypeScript reports no errors, and Vite completes a production build.

- [ ] **Step 7: Run the complete backend verification suite**

Run: `pytest -q`

Expected: all backend tests pass with no regressions in chat, research, coding, security, or PDF behavior.

- [ ] **Step 8: Perform browser visual QA**

Start the app and verify these exact states in the in-app browser:

1. At least 1280 px: outline, centered PDF, and docked assistant are visible.
2. At least 1280 px with both support panels closed: PDF remains centered and expands.
3. Between 900 and 1279 px: outline overlays; assistant remains docked.
4. Below 900 px: opening outline closes assistant and opening assistant closes outline.
5. A PDF without an outline shows `Trang N` navigation.
6. Search navigates to the correct page; a scanned PDF reports no searchable text.
7. A streamed response shows source chips; clicking one moves to the correct page.
8. Text selection, `Alt + drag`, pins, summarize, model picker, microphone, and change-file still work.
9. Keyboard focus is visible; Escape closes an overlay and restores focus.
10. Reduced-motion mode does not animate panel movement or PDF scale.

- [ ] **Step 9: Commit styling and accessibility**

```bash
git add frontend/src/styles/pdf.css frontend/src/styles/pdf-select.css frontend/src/styles/responsive.css frontend/src/components/pdf/pdfStyles.test.ts frontend/src/components/pdf
git commit -m "feat: polish responsive PDF workspace"
```

---

## Final Verification Gate

- [ ] Run `git status --short` and confirm only intentional files are modified.
- [ ] Run `pytest -q` from the repository root and record the passing test count.
- [ ] Run `npm test`, `npm run typecheck`, and `npm run build` from `frontend` and record each successful result.
- [ ] Re-run the ten browser QA states from Task 8 after the production build.
- [ ] Compare the final diff against `docs/superpowers/specs/2026-07-18-pdf-workspace-mvp-design.md`; every acceptance criterion must map to a passing test or recorded QA observation.
- [ ] Use `superpowers:requesting-code-review` before merge or PR handoff.
