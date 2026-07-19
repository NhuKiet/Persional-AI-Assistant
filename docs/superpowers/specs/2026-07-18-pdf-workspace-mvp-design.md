# PDF Workspace MVP Design

**Date:** 2026-07-18

**Status:** Approved design; awaiting written-spec review

**Scope:** Upgrade the existing PDF Chat workspace without replacing its upload, selection, pinning, summarization, model selection, session, or streaming behavior.

## 1. Objective

Turn PDF Chat from a 50/50 document-and-chat split into a reading-first workspace. The PDF is the central stage. A document outline on the left and an AI assistant on the right support reading, but neither competes with the document for equal width.

The MVP succeeds when a user can:

1. Open a PDF and read it comfortably in the center of the screen.
2. Navigate by document outline, page number, or search.
3. Ask questions while preserving the current text/image selection and pin workflows.
4. Inspect trustworthy page-level sources for an AI response and jump back to the relevant page.
5. Collapse either supporting panel to create more reading space.

## 2. Existing Capabilities to Preserve

The current implementation already supports:

- PDF upload and deletion with a 50 MB limit.
- Continuous page rendering through `react-pdf`.
- Text selection and `Alt + drag` image crops.
- Context pins for text and image selections.
- Streaming chat and document summarization.
- Model selection and a guard for image pins sent to non-vision local models.
- PDF chat sessions and conversation history.
- A draggable 50/50 PDF/chat divider.

The new workspace replaces the draggable 50/50 layout. It does not remove the remaining behaviors.

## 3. Product Decisions

### 3.1 Chosen Layout

Use a three-column, independently collapsible workspace:

```text
+----------------+------------------------------+---------------------+
| Document       |                              | AI assistant        |
| outline        |         PDF viewer           |                     |
| 220–240 px     |       remaining width        | 340–380 px          |
+----------------+------------------------------+---------------------+
```

- The PDF viewer always receives the remaining width and centers the rendered page.
- The outline and assistant are support panels, not resizable halves.
- Both panels can be collapsed independently.
- When both are collapsed, the workspace enters focus mode and the PDF expands while remaining centered.
- Entering PDF mode automatically collapses the app-wide history sidebar. The existing header control remains available for reopening it.
- Panel open/closed state persists in `localStorage`.

### 3.2 Default State

On a wide desktop:

- Document outline: open.
- AI assistant: open.
- App-wide history sidebar: collapsed.
- Viewer: fit-width mode, constrained so the page does not become unnecessarily wide.

### 3.3 Visual Direction

The workspace should feel like a focused technical reading desk rather than a decorative ebook.

- Retain the app's dark surfaces and existing design-token system.
- Retain coral `#FF8C69` as the PDF feature accent.
- Render PDF pages as neutral paper surfaces with restrained shadow and generous surrounding space.
- Avoid a simulated book gutter, page curl, or other ornamental book effects in the MVP.
- Reuse the app's existing typography tokens. Do not introduce a PDF-only font dependency.
- Use coral primarily for active navigation, selections, source links, and focus indication.

The signature interaction is a source chip that reconnects an AI answer to the exact PDF page and a visible excerpt highlight.

## 4. Workspace Behavior

### 4.1 Document Outline

- Read the actual outline exposed by the PDF document.
- Preserve hierarchy for nested outline items.
- Clicking an outline item resolves its destination and scrolls the viewer to the corresponding page.
- While the user scrolls, highlight the outline item associated with the current page.
- When the current page falls between two outline destinations, highlight the nearest preceding outline item.
- If the PDF has no outline, show a flat page list labeled `Trang 1`, `Trang 2`, and so on.
- The outline panel can be collapsed from its header.

The MVP does not use AI to infer headings or synthesize an outline.

### 4.2 PDF Toolbar

The toolbar contains:

- Current page and total page count.
- Previous and next page controls.
- Zoom out and zoom in.
- Fit-width control.
- Search control.
- Change-file action.
- Controls for opening a collapsed outline or assistant panel.

The page field accepts only values from `1` through `total_pages`. Invalid input returns to the current page rather than navigating.

After the PDF loads, the page count reported by PDF.js is canonical for viewer navigation and the page-list fallback. This keeps scanned PDFs navigable even when backend text extraction reports no text pages.

### 4.3 Viewer and Current Page

- Continue to use continuous vertical scrolling.
- Center each rendered page within the viewer.
- Track the current page using page visibility in the viewer viewport.
- Outline highlight and toolbar page count derive from the same current-page state.
- Preserve the existing text layer because selection and search depend on it.
- Preserve text selection, image crop, and selection toolbar behavior.

### 4.4 Search

- Extract searchable text from the loaded PDF on the client.
- Search is case-insensitive.
- Search preserves Vietnamese diacritics in the MVP; accent-insensitive matching is not required.
- Show the result count and allow previous/next result navigation.
- Navigating a result scrolls to its page and temporarily highlights the matched text when the text layer permits it.
- If exact text-layer highlighting fails, still navigate to the correct page.
- If the PDF contains no searchable text, disable search and explain that the document appears to be scanned.

OCR is outside the MVP.

### 4.5 AI Assistant

- Preserve streaming messages, summarization, model picker, input, microphone, pins, and empty-state suggestions.
- The assistant panel has a fixed docked width on wide screens and can be collapsed from its header.
- Selecting text or cropping an image may continue to send immediately for `explain` and `translate`, or remain pinned for follow-up discussion, matching current behavior.
- If a stream fails, retain the user's question and pins long enough to retry.

## 5. Grounded Sources

### 5.1 Source Authority

Source metadata comes from the chunks retrieved by the backend, not from page numbers written by the language model.

`PDFChunk.page` and `PDFChunk.index` are the source of truth. The backend emits source metadata before token streaming begins.

### 5.2 SSE Contract

Add a `sources` event to the existing stream:

```json
{
  "type": "sources",
  "sources": [
    {
      "page": 15,
      "chunk_index": 2,
      "excerpt": "Embeddings ánh xạ văn bản thành vectors..."
    }
  ]
}
```

Rules:

- Return at most five sources.
- Deduplicate identical `(page, chunk_index)` pairs.
- Preserve retrieval relevance order in the event.
- Truncate excerpts to a bounded display length without mutating the chunk used as model context.
- Do not emit an empty `sources` event when no source is available.
- Existing `token`, `done`, and `error` events keep their current meaning.

### 5.3 Frontend Source Interaction

- Attach the `sources` event to the assistant message currently being streamed.
- Render source chips beneath that response.
- A chip label uses the form `Trang 15 · Nguồn 2`, where `2` is the one-based display order within that response, not the backend `chunk_index`.
- Clicking a chip:
  1. Opens the viewer area if required.
  2. Scrolls to the source page.
  3. Attempts to locate the excerpt in the page text layer.
  4. Applies a temporary highlight when located.
  5. Keeps the excerpt visible in the assistant if exact location fails.

The MVP guarantees correct page navigation and a truthful excerpt. It does not guarantee exact sentence coordinates because the current extraction pipeline does not store PDF bounding boxes.

## 6. Responsive Behavior

### 6.1 Wide Desktop: 1280 px and Above

- Three docked columns.
- Outline and assistant can be collapsed independently.
- PDF receives all remaining width.

### 6.2 Laptop and Tablet Landscape: 900–1279 px

- Assistant remains docked on the right.
- Outline becomes a left drawer opened from the toolbar.
- Opening the drawer overlays the viewer instead of shrinking it.

### 6.3 Narrow Viewports: Below 900 px

- PDF occupies the workspace.
- Outline and assistant both open as mutually exclusive overlays.
- Opening one overlay closes the other.
- The PDF toolbar remains accessible without horizontal overflow.

## 7. Component Boundaries

### 7.1 Frontend

`PdfPage` remains the route-level coordinator for upload state, session state, model selection, and API calls. Workspace-specific behavior moves into focused components:

- `PdfWorkspace`: three-column layout, responsive mode, and panel visibility.
- `PdfOutline`: outline tree, fallback page list, and active item.
- `PdfToolbar`: navigation, zoom, fit width, search entry, and panel toggles.
- `PdfViewer`: rendering, zoom, current-page observation, and imperative page navigation.
- `PdfSearch`: query state, client-side text index, result navigation, and search highlight requests.
- `PdfSourceHighlight`: source excerpt matching and temporary highlight state.
- `PdfAssistantPanel`: file information, summary control, context pins, messages, and input.

`SelectionLayer`, `SelectionToolbar`, and `ContextPins` should remain reusable. Their public contracts may be extended only where the new viewer navigation requires it.

### 7.2 Backend

- `PDFProcessor.retrieve` remains responsible for selecting source chunks.
- Retrieval should occur once per chat request; the same retrieved chunks build both the LLM context and the `sources` event.
- `PdfService.chat_events` emits `sources` before the first `token` event.
- Source serialization is isolated in a small pure helper so ordering, deduplication, and excerpt truncation can be unit tested.
- No database or embedding migration is required for this MVP.

## 8. Data Flow

```text
User question
  -> PdfPage sends existing PDFChatRequest
  -> PdfService loads cached PDFDocument
  -> PDFProcessor.retrieve returns ranked PDFChunk objects
  -> service emits authoritative `sources` event
  -> the same chunks build LLM context
  -> service streams `token` events
  -> frontend stores sources on the active assistant message
  -> user clicks source chip
  -> PdfViewer scrolls to page
  -> PdfSourceHighlight locates excerpt or falls back to page-only focus
```

## 9. Error and Empty States

- **Canvas rendering fails:** show the existing viewer error and keep text chat available.
- **No outline:** show the page-list fallback.
- **No searchable text:** disable search with a scanned-document explanation.
- **Excerpt cannot be located:** navigate to the page and keep the excerpt visible; do not claim an exact highlight.
- **Stream or connection fails:** render the error inline and provide a retry path without discarding the question.
- **Image pin with unsupported model:** preserve the current vision-model guard.
- **File is missing:** leave the workspace and return to upload with a clear message.
- **Outline destination is invalid:** ignore that item, keep the viewer stable, and do not crash the outline tree.

## 10. Accessibility and Motion

- All toolbar and panel controls have accessible names.
- Panel toggles expose expanded/collapsed state.
- Focus remains visible on dark surfaces.
- Outline items, search results, and source chips are keyboard operable.
- Opening and closing overlays manages focus and supports Escape.
- Narrow-screen overlays trap focus while open.
- Motion uses existing duration/easing tokens and respects `prefers-reduced-motion`.
- Do not animate PDF canvas scale or page position continuously.

## 11. Testing Strategy

### 11.1 Backend

- Retrieved chunks and emitted sources are the same objects in the same relevance order.
- Sources emit before the first token.
- Duplicate source identifiers are removed.
- Source count and excerpt length limits are enforced.
- Empty retrieval does not emit a misleading source event.
- Existing stream, summary, session-lock, path-validation, and vision-guard tests continue to pass.

### 11.2 Frontend

- Outline destination resolves to the expected page.
- Missing outline renders a page-list fallback.
- Viewer current-page changes update both toolbar and outline.
- Source-chip click calls viewer navigation with the correct page.
- Failed excerpt matching falls back to page-only navigation.
- Search result navigation moves to the expected page.
- Panel state persists and responsive rules produce the intended dock/drawer/overlay mode.
- Existing text selection, image crop, pins, summarization, model selection, and streaming behavior do not regress.

### 11.3 Visual QA

Verify at minimum:

- Wide desktop with both panels open.
- Wide desktop focus mode.
- Laptop with outline drawer and docked assistant.
- Narrow layout with mutually exclusive overlays.
- Long nested outline.
- PDF without outline.
- Searchable PDF and scanned PDF.
- Streaming response with sources and without sources.

## 12. Acceptance Criteria

The MVP is complete when all of the following are true:

1. The PDF is centered and receives the remaining workspace width; the old 50/50 resize divider is gone.
2. The app history sidebar automatically collapses when the PDF workspace opens.
3. Outline and assistant panels follow the approved desktop, drawer, and overlay behavior.
4. Outline navigation, current-page tracking, page controls, zoom, fit width, and search work without breaking text selection.
5. AI answers can display backend-authoritative sources and each source navigates to the correct page.
6. Failure to locate an excerpt never produces a false exact highlight.
7. Existing upload, summary, pins, text selection, image crop, streaming, model selection, and vision guard behavior remains functional.
8. Automated tests cover the new source contract and the critical navigation state.
9. Keyboard use, focus visibility, overlay focus management, and reduced-motion behavior pass manual QA.

## 13. Non-Goals

The MVP does not include:

- OCR for scanned documents.
- AI-generated document outlines.
- Exact PDF bounding-box citations.
- Two-page book-spread mode.
- Page thumbnails.
- Technical-term extraction or glossary tabs.
- Annotations saved back into the PDF.
- Collaborative comments or document sharing.
- User-resizable outline and assistant widths.

These can be considered after the reading-first workspace and authoritative page-source flow are stable.
