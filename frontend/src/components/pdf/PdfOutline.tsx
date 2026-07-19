import type { ResolvedOutlineItem } from "./pdfDocument";

interface PdfOutlineProps {
  items: ResolvedOutlineItem[];
  totalPages: number;
  currentPage: number;
  onNavigate: (page: number) => void;
}

function activeOutlinePage(items: ResolvedOutlineItem[], currentPage: number): number | null {
  const pages: number[] = [];
  const collect = (nodes: ResolvedOutlineItem[]) => nodes.forEach((node) => {
    pages.push(node.page);
    collect(node.children);
  });

  collect(items);
  return pages.filter((page) => page <= currentPage).sort((a, b) => b - a)[0] ?? null;
}

interface OutlineItemsProps {
  items: ResolvedOutlineItem[];
  activePage: number | null;
  onNavigate: (page: number) => void;
}

function OutlineItems({ items, activePage, onNavigate }: OutlineItemsProps) {
  return (
    <ul>
      {items.map((item) => (
        <li key={`${item.title}:${item.page}`}>
          <button
            type="button"
            aria-current={item.page === activePage ? "page" : undefined}
            onClick={() => onNavigate(item.page)}
          >
            {item.title}
          </button>
          {item.children.length > 0 ? (
            <OutlineItems items={item.children} activePage={activePage} onNavigate={onNavigate} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export default function PdfOutline({ items, totalPages, currentPage, onNavigate }: PdfOutlineProps) {
  if (items.length > 0) {
    return (
      <nav aria-label="Mục lục PDF">
        <OutlineItems
          items={items}
          activePage={activeOutlinePage(items, currentPage)}
          onNavigate={onNavigate}
        />
      </nav>
    );
  }

  const pageCount = Math.max(0, Math.trunc(totalPages));
  return (
    <nav aria-label="Danh sách trang PDF">
      <ul>
        {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
          <li key={page}>
            <button
              type="button"
              aria-current={page === currentPage ? "page" : undefined}
              onClick={() => onNavigate(page)}
            >
              Trang {page}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
