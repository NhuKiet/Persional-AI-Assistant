import { createRef } from "react";
import { act, render, waitFor } from "@testing-library/react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Document, Page } from "react-pdf";
import { beforeEach, expect, it, vi } from "vitest";
import PdfViewer, { type PdfViewerHandle } from "./PdfViewer";

beforeEach(() => {
  vi.clearAllMocks();
});

function lastProps<Props>(calls: [Props][]): Props | undefined {
  return calls[calls.length - 1]?.[0];
}

function loadDocument(pdf: Pick<PDFDocumentProxy, "numPages" | "getPage">): void {
  const props = lastProps(vi.mocked(Document).mock.calls);
  act(() => props?.onLoadSuccess?.(pdf as PDFDocumentProxy));
}

function markTextLayerReady(pageNumber = 1): void {
  const call = [...vi.mocked(Page).mock.calls]
    .reverse()
    .find(([props]) => props.pageNumber === pageNumber);
  act(() => call?.[0].onRenderTextLayerSuccess?.());
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

it("scrolls to the clamped page through its public handle", () => {
  const ref = createRef<PdfViewerHandle>();
  const scrollIntoView = vi.fn();
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(scrollIntoView);

  const { container } = render(<PdfViewer ref={ref} file="/doc.pdf" />);
  const page = document.createElement("div");
  page.dataset.pageNumber = "1";
  container.querySelector(".pdf-viewer")?.appendChild(page);

  ref.current?.scrollToPage(99);

  expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
});

it("switches between bounded manual zoom and fit-width rendering", () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  const ref = createRef<PdfViewerHandle>();
  render(<PdfViewer ref={ref} file="/doc.pdf" />);
  loadDocument({ numPages: 1, getPage: vi.fn() as never });

  act(() => ref.current?.zoomIn());
  expect(lastProps(vi.mocked(Page).mock.calls)).toMatchObject({
    pageNumber: 1,
    scale: 1.15,
    width: undefined,
  });

  act(() => {
    for (let index = 0; index < 20; index += 1) ref.current?.zoomIn();
  });
  expect(lastProps(vi.mocked(Page).mock.calls)).toMatchObject({ scale: 2.5 });

  act(() => {
    for (let index = 0; index < 30; index += 1) ref.current?.zoomOut();
  });
  expect(lastProps(vi.mocked(Page).mock.calls)).toMatchObject({ scale: 0.5 });

  act(() => ref.current?.fitWidth());
  expect(lastProps(vi.mocked(Page).mock.calls)).toMatchObject({
    pageNumber: 1,
    scale: undefined,
    width: 784,
  });
});

it("reports the canonical PDF.js document and searchable page index", async () => {
  const onDocumentReady = vi.fn();
  const onSearchIndexReady = vi.fn();
  const { container } = render(
    <PdfViewer
      file="/doc.pdf"
      onDocumentReady={onDocumentReady}
      onSearchIndexReady={onSearchIndexReady}
    />,
  );
  const pdf = {
    numPages: 2,
    getPage: vi.fn(async (pageNumber: number) => ({
      getTextContent: async () => ({ items: [{ str: `Trang ${pageNumber}` }] }),
    })),
  };

  loadDocument(pdf as never);

  expect(onDocumentReady).toHaveBeenCalledWith(pdf, 2);
  expect(container.querySelectorAll(".pdf-page-wrap")).toHaveLength(2);
  await waitFor(() => {
    expect(onSearchIndexReady).toHaveBeenCalledWith([
      { page: 1, text: "Trang 1" },
      { page: 2, text: "Trang 2" },
    ]);
  });
});

it("publishes a search index only for the latest loaded PDF", async () => {
  const oldPage = deferred<{ getTextContent(): Promise<{ items: { str: string }[] }> }>();
  const onSearchIndexReady = vi.fn();
  render(<PdfViewer file="/doc.pdf" onSearchIndexReady={onSearchIndexReady} />);
  const oldPdf = {
    numPages: 1,
    getPage: vi.fn(() => oldPage.promise),
  };
  const newPdf = {
    numPages: 1,
    getPage: vi.fn(async () => ({
      getTextContent: async () => ({ items: [{ str: "Tài liệu mới" }] }),
    })),
  };

  loadDocument(oldPdf as never);
  loadDocument(newPdf as never);
  await waitFor(() => {
    expect(onSearchIndexReady).toHaveBeenCalledWith([
      { page: 1, text: "Tài liệu mới" },
    ]);
  });
  await act(async () => {
    oldPage.resolve({
      getTextContent: async () => ({ items: [{ str: "Tài liệu cũ" }] }),
    });
    await Promise.resolve();
  });

  expect(onSearchIndexReady.mock.calls).toEqual([[
    [{ page: 1, text: "Tài liệu mới" }],
  ]]);
});

it("does not publish a search index after unmount", async () => {
  const pendingPage = deferred<{ getTextContent(): Promise<{ items: { str: string }[] }> }>();
  const onSearchIndexReady = vi.fn();
  const { unmount } = render(
    <PdfViewer file="/doc.pdf" onSearchIndexReady={onSearchIndexReady} />,
  );
  loadDocument({
    numPages: 1,
    getPage: vi.fn(() => pendingPage.promise),
  } as never);

  unmount();
  await act(async () => {
    pendingPage.resolve({
      getTextContent: async () => ({ items: [{ str: "Quá muộn" }] }),
    });
    await Promise.resolve();
  });

  expect(onSearchIndexReady).not.toHaveBeenCalled();
});

it("invalidates pending search indexing when the file changes", async () => {
  const pendingPage = deferred<{ getTextContent(): Promise<{ items: { str: string }[] }> }>();
  const onSearchIndexReady = vi.fn();
  const { rerender } = render(
    <PdfViewer file="/old.pdf" onSearchIndexReady={onSearchIndexReady} />,
  );
  loadDocument({
    numPages: 1,
    getPage: vi.fn(() => pendingPage.promise),
  } as never);

  rerender(<PdfViewer file="/new.pdf" onSearchIndexReady={onSearchIndexReady} />);
  await act(async () => {
    pendingPage.resolve({
      getTextContent: async () => ({ items: [{ str: "Tài liệu cũ" }] }),
    });
    await Promise.resolve();
  });

  expect(onSearchIndexReady).not.toHaveBeenCalled();
});

it("ignores an old document load callback after the file changes", async () => {
  const onDocumentReady = vi.fn();
  const onSearchIndexReady = vi.fn();
  const { container, rerender } = render(
    <PdfViewer
      file="/old.pdf"
      onDocumentReady={onDocumentReady}
      onSearchIndexReady={onSearchIndexReady}
    />,
  );
  const oldDocumentProps = lastProps(vi.mocked(Document).mock.calls);
  rerender(
    <PdfViewer
      file="/new.pdf"
      onDocumentReady={onDocumentReady}
      onSearchIndexReady={onSearchIndexReady}
    />,
  );
  const oldPdf = {
    numPages: 2,
    getPage: vi.fn(async () => ({
      getTextContent: async () => ({ items: [{ str: "Tài liệu cũ" }] }),
    })),
  };

  await act(async () => {
    oldDocumentProps?.onLoadSuccess?.(oldPdf as never);
    await Promise.resolve();
  });

  expect(onDocumentReady).not.toHaveBeenCalled();
  expect(onSearchIndexReady).not.toHaveBeenCalled();
  expect(container.querySelectorAll(".pdf-page-wrap")).toHaveLength(0);
});

it("contains search-index extraction errors", async () => {
  const onSearchIndexReady = vi.fn();
  render(<PdfViewer file="/doc.pdf" onSearchIndexReady={onSearchIndexReady} />);

  loadDocument({
    numPages: 1,
    getPage: vi.fn().mockRejectedValue(new Error("text extraction failed")),
  } as never);
  await act(async () => {
    await Promise.resolve();
  });

  expect(onSearchIndexReady).not.toHaveBeenCalled();
});

it("reports document rendering failures without replacing the viewer parent", () => {
  const onDocumentError = vi.fn();
  const { getByText } = render(
    <PdfViewer file="/doc.pdf" onDocumentError={onDocumentError} />,
  );
  const error = new Error("worker failed");
  const props = lastProps(vi.mocked(Document).mock.calls);

  act(() => props?.onLoadError?.(error));

  expect(onDocumentError).toHaveBeenCalledWith(error);
  expect(getByText(/Vẫn có thể chat bằng text/)).toBeInTheDocument();
});

it("measures exact page geometry when visible ratios swap within one threshold bucket", () => {
  let observerCallback: IntersectionObserverCallback | undefined;
  const disconnect = vi.fn();
  class IntersectionObserverMock {
    constructor(callback: IntersectionObserverCallback) {
      observerCallback = callback;
    }
    observe() {}
    unobserve() {}
    disconnect = disconnect;
  }
  vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);
  let frameCallback: FrameRequestCallback | undefined;
  let nextFrameId = 0;
  const cancelAnimationFrame = vi.fn();
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    frameCallback = callback;
    nextFrameId += 1;
    return nextFrameId;
  }));
  vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
  const onCurrentPageChange = vi.fn();
  const { container, unmount } = render(
    <PdfViewer file="/doc.pdf" onCurrentPageChange={onCurrentPageChange} />,
  );
  loadDocument({ numPages: 2, getPage: vi.fn() as never });
  const pages = container.querySelectorAll<HTMLElement>(".pdf-page-wrap");
  const host = container.querySelector<HTMLElement>(".pdf-viewer")!;
  const rect = (top: number, bottom: number): DOMRect => ({
    top, bottom, left: 0, right: 100, width: 100, height: bottom - top,
    x: 0, y: top, toJSON: () => ({}),
  });
  vi.spyOn(host, "getBoundingClientRect").mockReturnValue(rect(0, 100));
  const pageOneRect = vi.spyOn(pages[0], "getBoundingClientRect")
    .mockReturnValue(rect(-44, 56));
  const pageTwoRect = vi.spyOn(pages[1], "getBoundingClientRect")
    .mockReturnValue(rect(46, 146));
  const flushFrame = () => {
    const callback = frameCallback;
    frameCallback = undefined;
    act(() => callback?.(performance.now()));
  };

  act(() => {
    observerCallback?.([
      { target: pages[0], isIntersecting: true, intersectionRatio: 0.56 },
      { target: pages[1], isIntersecting: true, intersectionRatio: 0.54 },
    ] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
  });
  flushFrame();

  pageOneRect.mockReturnValue(rect(-46, 54));
  pageTwoRect.mockReturnValue(rect(44, 144));
  act(() => {
    host.dispatchEvent(new Event("scroll"));
  });
  flushFrame();

  expect(onCurrentPageChange.mock.calls).toEqual([[1], [2]]);
  act(() => host.dispatchEvent(new Event("scroll")));
  unmount();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(cancelAnimationFrame).toHaveBeenCalled();
});

it("maps collapsed whitespace offsets to the correct text-layer spans", () => {
  const ref = createRef<PdfViewerHandle>();
  const { container } = render(<PdfViewer ref={ref} file="/doc.pdf" />);
  loadDocument({ numPages: 1, getPage: vi.fn() as never });
  const page = container.querySelector<HTMLElement>(".pdf-page-wrap")!;
  const textLayer = document.createElement("div");
  textLayer.className = "textLayer";
  const spans = ["Alpha  ", "Embeddings", " Omega"].map((text) => {
    const span = document.createElement("span");
    span.textContent = text;
    textLayer.appendChild(span);
    return span;
  });
  page.appendChild(textLayer);
  markTextLayerReady();

  act(() => ref.current?.highlightExcerpt(1, "embeddings"));

  expect(spans[0]).not.toHaveClass("pdf-source-highlight");
  expect(spans[1]).toHaveClass("pdf-source-highlight");
  expect(spans[2]).not.toHaveClass("pdf-source-highlight");
});

it("clears an active source highlight when the PDF file changes", () => {
  const ref = createRef<PdfViewerHandle>();
  const { container, rerender } = render(
    <PdfViewer ref={ref} file="/old.pdf" />,
  );
  loadDocument({ numPages: 1, getPage: vi.fn() as never });
  const page = container.querySelector<HTMLElement>(".pdf-page-wrap")!;
  const textLayer = document.createElement("div");
  textLayer.className = "textLayer";
  const span = document.createElement("span");
  span.textContent = "Alpha Embeddings";
  textLayer.appendChild(span);
  page.appendChild(textLayer);
  markTextLayerReady();
  act(() => ref.current?.highlightExcerpt(1, "embeddings"));
  expect(span).toHaveClass("pdf-source-highlight");

  rerender(<PdfViewer ref={ref} file="/new.pdf" />);

  expect(span).not.toHaveClass("pdf-source-highlight");
});

it("waits beyond one second for text-layer readiness before highlighting", () => {
  vi.useFakeTimers();
  const ref = createRef<PdfViewerHandle>();
  const { container, unmount } = render(<PdfViewer ref={ref} file="/doc.pdf" />);
  loadDocument({ numPages: 1, getPage: vi.fn() as never });
  const page = container.querySelector<HTMLElement>(".pdf-page-wrap")!;

  act(() => ref.current?.highlightExcerpt(1, "embeddings"));
  act(() => vi.advanceTimersByTime(1500));
  expect(page).not.toHaveClass("pdf-source-page-target");
  const textLayer = document.createElement("div");
  textLayer.className = "textLayer";
  const span = document.createElement("span");
  span.textContent = "Alpha Embeddings";
  textLayer.appendChild(span);
  page.appendChild(textLayer);

  markTextLayerReady();

  expect(span).toHaveClass("pdf-source-highlight");
  expect(page).not.toHaveClass("pdf-source-page-target");
  unmount();
  vi.useRealTimers();
});

it("uses page fallback only after a ready text layer has no match", () => {
  vi.useFakeTimers();
  const ref = createRef<PdfViewerHandle>();
  const { container, unmount } = render(<PdfViewer ref={ref} file="/doc.pdf" />);
  loadDocument({ numPages: 1, getPage: vi.fn() as never });
  const page = container.querySelector<HTMLElement>(".pdf-page-wrap")!;
  const textLayer = document.createElement("div");
  textLayer.className = "textLayer";
  const span = document.createElement("span");
  span.textContent = "Alpha";
  textLayer.appendChild(span);
  page.appendChild(textLayer);

  act(() => ref.current?.highlightExcerpt(1, "missing excerpt"));
  expect(page).not.toHaveClass("pdf-source-page-target");
  markTextLayerReady();

  expect(page).toHaveClass("pdf-source-page-target");
  act(() => vi.advanceTimersByTime(4000));
  expect(page).not.toHaveClass("pdf-source-page-target");
  unmount();
  vi.useRealTimers();
});
