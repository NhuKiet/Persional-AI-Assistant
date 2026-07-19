import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { clampPage } from "./pdfDocument";

interface PdfToolbarProps {
  filename: string;
  currentPage: number;
  totalPages: number;
  outlineOpen: boolean;
  assistantOpen: boolean;
  onNavigate: (page: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  onToggleSearch: () => void;
  onToggleOutline: () => void;
  onToggleAssistant: () => void;
  onChangeFile: () => void;
}

export default function PdfToolbar({
  filename,
  currentPage,
  totalPages,
  outlineOpen,
  assistantOpen,
  onNavigate,
  onPrevious,
  onNext,
  onZoomIn,
  onZoomOut,
  onFitWidth,
  onToggleSearch,
  onToggleOutline,
  onToggleAssistant,
  onChangeFile,
}: PdfToolbarProps) {
  const [pageInput, setPageInput] = useState(String(currentPage));

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  const commitPageInput = () => {
    if (pageInput.trim() === "") {
      setPageInput(String(currentPage));
      return;
    }

    const enteredPage = Number(pageInput);
    if (!Number.isFinite(enteredPage)) {
      setPageInput(String(currentPage));
      return;
    }

    const page = clampPage(enteredPage, totalPages);
    setPageInput(String(page));
    onNavigate(page);
  };

  const submitPage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    commitPageInput();
  };

  const onPageInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    commitPageInput();
  };

  return (
    <div className="pdf-toolbar" role="toolbar" aria-label="Công cụ PDF">
      <div className="pdf-toolbar-document">
        <button
          aria-expanded={outlineOpen}
          aria-label={outlineOpen ? "Ẩn mục lục" : "Mở mục lục"}
          onClick={onToggleOutline}
          type="button"
        >
          Mục lục
        </button>
        <span className="pdf-toolbar-filename" title={filename}>{filename}</span>
      </div>

      <div className="pdf-toolbar-navigation">
        <button
          aria-label="Trang trước"
          disabled={totalPages < 1 || currentPage <= 1}
          onClick={onPrevious}
          type="button"
        >
          ‹
        </button>
        <form aria-label="Điều hướng trang PDF" onSubmit={submitPage}>
          <input
            aria-label="Trang hiện tại"
            disabled={totalPages < 1}
            inputMode="numeric"
            max={Math.max(1, totalPages)}
            min={1}
            onChange={(event) => setPageInput(event.target.value)}
            onKeyDown={onPageInputKeyDown}
            type="number"
            value={pageInput}
          />
          <span aria-label={`Tổng số trang: ${totalPages}`}>/ {totalPages}</span>
        </form>
        <button
          aria-label="Trang tiếp theo"
          disabled={totalPages < 1 || currentPage >= totalPages}
          onClick={onNext}
          type="button"
        >
          ›
        </button>
      </div>

      <div className="pdf-toolbar-view">
        <button aria-label="Thu nhỏ" onClick={onZoomOut} type="button">−</button>
        <button aria-label="Phóng to" onClick={onZoomIn} type="button">+</button>
        <button aria-label="Vừa chiều rộng" onClick={onFitWidth} type="button">Vừa rộng</button>
        <button aria-label="Tìm trong PDF" onClick={onToggleSearch} type="button">Tìm</button>
      </div>

      <div className="pdf-toolbar-actions">
        <button
          aria-expanded={assistantOpen}
          aria-label={assistantOpen ? "Ẩn trợ lý tài liệu" : "Hỏi tài liệu"}
          onClick={onToggleAssistant}
          type="button"
        >
          Hỏi tài liệu
        </button>
        <button aria-label="Đổi tệp" onClick={onChangeFile} type="button">Đổi tệp</button>
      </div>
    </div>
  );
}
