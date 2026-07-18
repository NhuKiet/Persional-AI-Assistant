import { useState, useCallback, useRef, useLayoutEffect, type RefObject } from "react";
import { Document, Page, pdfjs } from "react-pdf";
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
}

export default function PdfViewer({ file, onCanvasReady }: PdfViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const [error, setError]       = useState<Error | null>(null);
  const hostRef                 = useRef<HTMLDivElement>(null);
  // Vừa khít bề rộng pane thay vì scale cố định — pane co giãn được nên
  // scale cứng làm trang tràn ngang.
  const fitWidth                = useFitWidth(hostRef);

  const onLoad = useCallback(({ numPages }: { numPages: number }) => setNumPages(numPages), []);

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
      <Document file={file} onLoadSuccess={onLoad} onLoadError={setError} loading="Đang tải PDF…">
        {Array.from({ length: numPages }, (_, i) => (
          <div className="pdf-page-wrap" data-page-number={i + 1} key={i}>
            <Page
              pageNumber={i + 1}
              // Chưa đo được thì để react-pdf dùng cỡ mặc định: thà hiển thị
              // sai bề rộng một nhịp còn hơn pane trắng nếu phép đo hụt.
              width={fitWidth > 0 ? fitWidth : undefined}
              renderTextLayer
              renderAnnotationLayer={false}
              onRenderSuccess={() => handleRender(i + 1)}
            />
          </div>
        ))}
      </Document>
    </div>
  );
}
