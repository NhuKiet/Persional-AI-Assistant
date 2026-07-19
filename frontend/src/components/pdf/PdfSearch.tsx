import { useEffect, useMemo, useState } from "react";
import {
  searchPdfPages,
  type PdfSearchPage,
  type PdfSearchResult,
} from "./pdfDocument";

interface PdfSearchProps {
  pages: PdfSearchPage[];
  onOpenResult: (result: PdfSearchResult) => void;
  onClose: () => void;
}

export default function PdfSearch({ pages, onOpenResult, onClose }: PdfSearchProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const results = useMemo(() => searchPdfPages(pages, query), [pages, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [pages, query]);

  useEffect(() => {
    if (results.length > 0) onOpenResult(results[activeIndex]);
  }, [activeIndex, onOpenResult, results]);

  const openAt = (nextIndex: number) => {
    if (!results.length) return;
    setActiveIndex((nextIndex + results.length) % results.length);
  };

  return (
    <section aria-label="Tìm kiếm PDF">
      <label>
        Tìm trong PDF
        <input
          aria-label="Tìm trong PDF"
          onChange={(event) => setQuery(event.target.value)}
          type="search"
          value={query}
        />
      </label>
      <button aria-label="Đóng tìm kiếm" onClick={onClose} type="button">Đóng</button>

      {pages.length === 0 ? (
        <p role="status">Không có văn bản để tìm kiếm</p>
      ) : query && results.length === 0 ? (
        <p role="status">Không tìm thấy kết quả</p>
      ) : results.length > 0 ? (
        <div>
          <output aria-live="polite">{activeIndex + 1} / {results.length}</output>
          <button
            aria-label="Kết quả trước đó"
            onClick={() => openAt(activeIndex - 1)}
            type="button"
          >
            Trước
          </button>
          <button
            aria-label="Kết quả tiếp theo"
            onClick={() => openAt(activeIndex + 1)}
            type="button"
          >
            Tiếp theo
          </button>
        </div>
      ) : null}
    </section>
  );
}
