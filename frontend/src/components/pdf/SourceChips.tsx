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
