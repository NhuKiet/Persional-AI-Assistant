import {
  forwardRef,
  useState,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useLayoutEffect,
  useMemo,
  type RefObject,
} from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Document, Page, pdfjs } from "react-pdf";
import {
  buildPdfSearchPages,
  clampPage,
  findExcerptSpanIndexes,
  type PdfSearchPage,
} from "./pdfDocument";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";

// pdf.js worker từ bản pdfjs-dist đã cài (không CDN → chạy offline).
// Phải dùng `?url`: Vite không phân giải bare specifier bên trong
// new URL("pdfjs-dist/...", import.meta.url) — nó ghép tương đối theo module
// thành /src/pdf/pdfjs-dist/... rồi rơi vào SPA fallback trả về index.html,
// tức worker nhận HTML thay vì script.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const PAGE_GUTTER = 16; // chừa chỗ cho padding/scrollbar dọc
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;
const SCALE_STEP = 0.15;
const HIGHLIGHT_DISPLAY_MS = 4000;

function resolveScrollHost(viewer: HTMLElement): HTMLElement {
  let candidate: HTMLElement | null = viewer;
  while (candidate) {
    const style = window.getComputedStyle(candidate);
    const permitsScrolling = /(auto|scroll|overlay)/.test(
      `${style.overflow} ${style.overflowX} ${style.overflowY}`,
    );
    const hasScrollableContent = candidate.scrollHeight > candidate.clientHeight
      || candidate.scrollWidth > candidate.clientWidth;
    if (permitsScrolling && hasScrollableContent) return candidate;
    candidate = candidate.parentElement;
  }
  return viewer;
}

/** Bề rộng khả dụng của khung chứa; cập nhật khi kéo thanh chia hoặc resize. */
function useFitWidth(hostRef: RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0);

  // useLayoutEffect: đo trước khi paint để không chớp một nhịp sai cỡ.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => setWidth(Math.max(0, host.clientWidth - PAGE_GUTTER));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [hostRef]);

  return width;
}

interface PdfViewerProps {
  file: string;
  onCanvasReady?: (pageNum: number, canvas: HTMLCanvasElement) => void;
  onDocumentReady?: (pdf: PDFDocumentProxy, totalPages: number) => void;
  onDocumentError?: (error: Error) => void;
  onCurrentPageChange?: (page: number) => void;
  onSearchIndexReady?: (pages: PdfSearchPage[]) => void;
}

export interface PdfViewerHandle {
  scrollToPage(page: number): void;
  zoomIn(): void;
  zoomOut(): void;
  fitWidth(): void;
  highlightExcerpt(page: number, excerpt: string): void;
}

interface SourceHighlight {
  file: string;
  page: number;
  excerpt: string;
  key: number;
}

const PdfViewer = forwardRef<PdfViewerHandle, PdfViewerProps>(function PdfViewer(
  {
    file,
    onCanvasReady,
    onDocumentReady,
    onDocumentError,
    onCurrentPageChange,
    onSearchIndexReady,
  },
  ref,
) {
  const [numPages, setNumPages] = useState(0);
  const [error, setError]       = useState<Error | null>(null);
  const [manualScale, setManualScale] = useState(1);
  const [viewMode, setViewMode] = useState<"fit-width" | "manual">("fit-width");
  const [sourceHighlight, setSourceHighlight] = useState<SourceHighlight | null>(null);
  const [targetReadinessRevision, setTargetReadinessRevision] = useState(0);
  const [documentRenderRevision, setDocumentRenderRevision] = useState(0);
  const hostRef                 = useRef<HTMLDivElement>(null);
  const currentPageRef          = useRef<number | null>(null);
  const searchGenerationRef     = useRef(0);
  const activeDocumentLoadRef   = useRef<((pdf: PDFDocumentProxy) => void) | null>(null);
  // Vừa khít bề rộng pane thay vì scale cố định — pane co giãn được nên
  // scale cứng làm trang tràn ngang.
  const fitWidth                = useFitWidth(hostRef);
  const textRenderOwner = useMemo(() => Symbol("pdf-text-render"), [
    documentRenderRevision,
    file,
    fitWidth,
    manualScale,
    viewMode,
  ]);
  const activeTextRenderOwnerRef = useRef<symbol | null>(null);
  const readyTextLayerOwnersRef = useRef<Map<number, symbol>>(new Map());

  const onLoad = useCallback(function handleDocumentLoad(pdf: PDFDocumentProxy) {
    if (activeDocumentLoadRef.current !== handleDocumentLoad) return;
    setDocumentRenderRevision((revision) => revision + 1);
    setNumPages(pdf.numPages);
    onDocumentReady?.(pdf, pdf.numPages);
    const generation = ++searchGenerationRef.current;
    if (onSearchIndexReady) {
      void buildPdfSearchPages(pdf).then((pages) => {
        if (
          activeDocumentLoadRef.current === handleDocumentLoad
          && searchGenerationRef.current === generation
        ) {
          onSearchIndexReady(pages);
        }
      }).catch(() => {
        // Search indexing is optional; document rendering remains usable on extraction failure.
      });
    }
  }, [file, onDocumentReady, onSearchIndexReady]);

  useLayoutEffect(() => {
    activeDocumentLoadRef.current = onLoad;
    return () => {
      if (activeDocumentLoadRef.current === onLoad) {
        activeDocumentLoadRef.current = null;
      }
    };
  }, [onLoad]);

  useLayoutEffect(() => {
    activeTextRenderOwnerRef.current = textRenderOwner;
    readyTextLayerOwnersRef.current.clear();
    setTargetReadinessRevision((revision) => revision + 1);
    return () => {
      if (activeTextRenderOwnerRef.current === textRenderOwner) {
        activeTextRenderOwnerRef.current = null;
      }
    };
  }, [textRenderOwner]);

  useEffect(() => () => {
    searchGenerationRef.current += 1;
  }, [file]);

  useEffect(() => {
    setError(null);
    setSourceHighlight(null);
  }, [file]);

  const handleTextLayerReady = useCallback((
    loadOwner: (pdf: PDFDocumentProxy) => void,
    renderOwner: symbol,
    page: number,
  ) => {
    if (
      activeDocumentLoadRef.current !== loadOwner
      || activeTextRenderOwnerRef.current !== renderOwner
    ) return;
    readyTextLayerOwnersRef.current.set(page, renderOwner);
    if (sourceHighlight?.page === page) {
      setTargetReadinessRevision((revision) => revision + 1);
    }
  }, [sourceHighlight?.page]);

  const handleDocumentError = useCallback((
    loadOwner: (pdf: PDFDocumentProxy) => void,
    loadError: Error,
  ) => {
    if (activeDocumentLoadRef.current !== loadOwner) return;
    setError(loadError);
    onDocumentError?.(loadError);
  }, [onDocumentError]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || numPages < 1 || !onCurrentPageChange) return;

    const scrollHost = resolveScrollHost(host);
    const pages = Array.from(host.querySelectorAll<HTMLElement>(".pdf-page-wrap"));
    let frameId: number | null = null;

    const measureCurrentPage = () => {
      frameId = null;
      const hostRect = scrollHost.getBoundingClientRect();
      const mostVisible = pages.reduce<{ page: number; ratio: number } | null>((best, page) => {
        const pageRect = page.getBoundingClientRect();
        const visibleWidth = Math.max(
          0,
          Math.min(hostRect.right, pageRect.right) - Math.max(hostRect.left, pageRect.left),
        );
        const visibleHeight = Math.max(
          0,
          Math.min(hostRect.bottom, pageRect.bottom) - Math.max(hostRect.top, pageRect.top),
        );
        const pageArea = pageRect.width * pageRect.height;
        const ratio = pageArea > 0 ? (visibleWidth * visibleHeight) / pageArea : 0;
        const pageNumber = Number(page.dataset.pageNumber);
        return ratio > 0 && Number.isInteger(pageNumber) && (!best || ratio > best.ratio)
          ? { page: pageNumber, ratio }
          : best;
      }, null);

      if (!mostVisible || mostVisible.page === currentPageRef.current) return;
      currentPageRef.current = mostVisible.page;
      onCurrentPageChange(mostVisible.page);
    };

    const scheduleMeasurement = () => {
      if (frameId !== null) return;
      frameId = requestAnimationFrame(measureCurrentPage);
    };

    const observer = new IntersectionObserver(scheduleMeasurement, { root: scrollHost });
    const resizeObserver = new ResizeObserver(scheduleMeasurement);
    pages.forEach((page) => {
      observer.observe(page);
      resizeObserver.observe(page);
    });
    resizeObserver.observe(scrollHost);
    scrollHost.addEventListener("scroll", scheduleMeasurement, { passive: true });
    window.addEventListener("resize", scheduleMeasurement);
    scheduleMeasurement();

    return () => {
      scrollHost.removeEventListener("scroll", scheduleMeasurement);
      window.removeEventListener("resize", scheduleMeasurement);
      observer.disconnect();
      resizeObserver.disconnect();
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
    };
  }, [numPages, onCurrentPageChange]);

  useEffect(() => {
    if (!sourceHighlight || sourceHighlight.file !== file) return;
    if (readyTextLayerOwnersRef.current.get(sourceHighlight.page) !== textRenderOwner) return;

    const wrapper = hostRef.current?.querySelector<HTMLElement>(
      `[data-page-number="${sourceHighlight.page}"]`,
    );
    if (!wrapper) return;
    const spans = Array.from(wrapper.querySelectorAll<HTMLElement>(".textLayer span"));
    const matchingSpanIndexes = findExcerptSpanIndexes(
      spans.map((span) => span.textContent ?? ""),
      sourceHighlight.excerpt,
    );
    const highlightedSpans = matchingSpanIndexes
      .map((spanIndex) => spans[spanIndex])
      .filter((span): span is HTMLElement => Boolean(span));

    if (highlightedSpans.length > 0) {
      highlightedSpans.forEach((span) => span.classList.add("pdf-source-highlight"));
    } else {
      wrapper.classList.add("pdf-source-page-target");
    }

    const clearTimeout = window.setTimeout(() => {
      highlightedSpans.forEach((span) => span.classList.remove("pdf-source-highlight"));
      wrapper.classList.remove("pdf-source-page-target");
      setSourceHighlight((current) => current?.key === sourceHighlight.key ? null : current);
    }, HIGHLIGHT_DISPLAY_MS);

    return () => {
      window.clearTimeout(clearTimeout);
      highlightedSpans.forEach((span) => span.classList.remove("pdf-source-highlight"));
      wrapper.classList.remove("pdf-source-page-target");
    };
  }, [file, sourceHighlight, targetReadinessRevision, textRenderOwner]);

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
      const targetPage = clampPage(page, numPages);
      setSourceHighlight({ file, page: targetPage, excerpt, key: Date.now() });
      const target = hostRef.current?.querySelector<HTMLElement>(
        `[data-page-number="${targetPage}"]`,
      );
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
  }), [file, numPages]);

  const handleRender = useCallback((pageNum: number) => {
    // react-pdf render canvas với class .react-pdf__Page__canvas trong wrapper trang
    const wrapper = hostRef.current?.querySelector(`[data-page-number="${pageNum}"]`);
    const canvas  = wrapper?.querySelector("canvas");
    if (canvas && onCanvasReady) onCanvasReady(pageNum, canvas);
  }, [onCanvasReady]);

  if (error) {
    return <div className="pdf-error">Không render được PDF ({String(error)}). Vẫn có thể chat bằng text.</div>;
  }

  return (
    <div className="pdf-viewer" ref={hostRef}>
      <Document
        file={file}
        onLoadSuccess={onLoad}
        onLoadError={(loadError) => handleDocumentError(onLoad, loadError)}
        loading="Đang tải PDF…"
      >
        {Array.from({ length: numPages }, (_, i) => (
          <div className="pdf-page-wrap" data-page-number={i + 1} key={i}>
            <Page
              pageNumber={i + 1}
              // Chưa đo được thì để react-pdf dùng cỡ mặc định: thà hiển thị
              // sai bề rộng một nhịp còn hơn pane trắng nếu phép đo hụt.
              width={viewMode === "fit-width" && fitWidth > 0 ? fitWidth : undefined}
              scale={viewMode === "manual" ? manualScale : undefined}
              renderTextLayer
              renderAnnotationLayer={false}
              onRenderSuccess={() => handleRender(i + 1)}
              onRenderTextLayerSuccess={() => handleTextLayerReady(onLoad, textRenderOwner, i + 1)}
            />
          </div>
        ))}
      </Document>
    </div>
  );
});

export default PdfViewer;
