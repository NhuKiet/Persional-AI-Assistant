import {
  forwardRef,
  useState,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useLayoutEffect,
  type RefObject,
} from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Document, Page, pdfjs } from "react-pdf";
import {
  buildPdfSearchPages,
  clampPage,
  findExcerptRange,
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
  const hostRef                 = useRef<HTMLDivElement>(null);
  const currentPageRef          = useRef<number | null>(null);
  // Vừa khít bề rộng pane thay vì scale cố định — pane co giãn được nên
  // scale cứng làm trang tràn ngang.
  const fitWidth                = useFitWidth(hostRef);

  const onLoad = useCallback((pdf: PDFDocumentProxy) => {
    setNumPages(pdf.numPages);
    onDocumentReady?.(pdf, pdf.numPages);
    if (onSearchIndexReady) {
      void buildPdfSearchPages(pdf).then(onSearchIndexReady);
    }
  }, [onDocumentReady, onSearchIndexReady]);

  const handleDocumentError = useCallback((loadError: Error) => {
    setError(loadError);
    onDocumentError?.(loadError);
  }, [onDocumentError]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || numPages < 1 || !onCurrentPageChange) return;

    const observer = new IntersectionObserver((entries) => {
      const mostVisible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
      const page = Number((mostVisible?.target as HTMLElement | undefined)?.dataset.pageNumber);

      if (!Number.isInteger(page) || page === currentPageRef.current) return;
      currentPageRef.current = page;
      onCurrentPageChange(page);
    });

    host.querySelectorAll(".pdf-page-wrap").forEach((page) => observer.observe(page));
    return () => observer.disconnect();
  }, [numPages, onCurrentPageChange]);

  useEffect(() => {
    if (!sourceHighlight) return;

    const wrapper = hostRef.current?.querySelector<HTMLElement>(
      `[data-page-number="${sourceHighlight.page}"]`,
    );
    if (!wrapper) return;

    const spans = Array.from(wrapper.querySelectorAll<HTMLElement>(".textLayer span"));
    const text = spans.map((span) => span.textContent ?? "").join("");
    const range = findExcerptRange(text, sourceHighlight.excerpt);

    if (range) {
      let offset = 0;
      spans.forEach((span) => {
        const end = offset + (span.textContent?.length ?? 0);
        if (offset < range.end && end > range.start) {
          span.classList.add("pdf-source-highlight");
        }
        offset = end;
      });
    } else {
      wrapper.classList.add("pdf-source-page-target");
    }

    const timeout = window.setTimeout(() => {
      spans.forEach((span) => span.classList.remove("pdf-source-highlight"));
      wrapper.classList.remove("pdf-source-page-target");
    }, 4000);

    return () => {
      window.clearTimeout(timeout);
      spans.forEach((span) => span.classList.remove("pdf-source-highlight"));
      wrapper.classList.remove("pdf-source-page-target");
    };
  }, [sourceHighlight]);

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
      setSourceHighlight({ page: targetPage, excerpt, key: Date.now() });
      const target = hostRef.current?.querySelector<HTMLElement>(
        `[data-page-number="${targetPage}"]`,
      );
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
  }), [numPages]);

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
        onLoadError={handleDocumentError}
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
            />
          </div>
        ))}
      </Document>
    </div>
  );
});

export default PdfViewer;
