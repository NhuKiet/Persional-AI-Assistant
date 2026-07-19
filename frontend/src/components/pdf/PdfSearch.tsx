import { useEffect, useMemo, useState } from "react";
import {
  normalizeSearchText,
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
  const [requestedIndex, setRequestedIndex] = useState(0);
  const results = useMemo(() => searchPdfPages(pages, query), [pages, query]);
  const hasSearchableText = useMemo(
    () => pages.some((page) => page.text.trim().length > 0),
    [pages],
  );
  const hasQuery = normalizeSearchText(query).length > 0;
  const activeIndex = results.length > 0 ? Math.min(requestedIndex, results.length - 1) : 0;
  const activeResult = results[activeIndex];

  useEffect(() => {
    setRequestedIndex(0);
  }, [pages, query]);

  useEffect(() => {
    if (activeResult) onOpenResult(activeResult);
  }, [activeResult, onOpenResult]);

  const openAt = (nextIndex: number) => {
    if (!results.length) return;
    setRequestedIndex((nextIndex + results.length) % results.length);
  };

  return (
    <section aria-label="Tìm kiếm PDF">
      <label>
        Tìm trong PDF
        <input
          aria-label="Tìm trong PDF"
          disabled={!hasSearchableText}
          onChange={(event) => setQuery(event.target.value)}
          type="search"
          value={query}
        />
      </label>
      <button aria-label="Đóng tìm kiếm" onClick={onClose} type="button">Đóng</button>

      {!hasSearchableText ? (
        <p role="status">Không có văn bản để tìm kiếm</p>
      ) : hasQuery && results.length === 0 ? (
        <p role="status">Không tìm thấy kết quả</p>
      ) : null}
      <div>
        {results.length > 0 ? (
          <output aria-live="polite">{activeIndex + 1} / {results.length}</output>
        ) : null}
        <button
          aria-label="Kết quả trước đó"
          disabled={!activeResult}
          onClick={() => openAt(activeIndex - 1)}
          type="button"
        >
          Trước
        </button>
        <button
          aria-label="Kết quả tiếp theo"
          disabled={!activeResult}
          onClick={() => openAt(activeIndex + 1)}
          type="button"
        >
          Tiếp theo
        </button>
      </div>
    </section>
  );
}
