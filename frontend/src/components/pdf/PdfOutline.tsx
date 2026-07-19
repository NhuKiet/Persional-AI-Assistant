import type { ResolvedOutlineItem } from "./pdfDocument";

interface PdfOutlineProps {
  items: ResolvedOutlineItem[];
  totalPages: number;
  currentPage: number;
  onNavigate: (page: number) => void;
}

function activeOutlineId(items: ResolvedOutlineItem[], currentPage: number): string | null {
  const candidates: Array<{ id: string; page: number; order: number }> = [];
  let order = 0;
  const collect = (nodes: ResolvedOutlineItem[], parentId: string) => nodes.forEach((node, index) => {
    const id = `${parentId}/${index}`;
    const nodeOrder = order;
    order += 1;

    if (node.page <= currentPage) candidates.push({ id, page: node.page, order: nodeOrder });

    collect(node.children, id);
  });

  collect(items, "outline");
  return candidates.reduce<typeof candidates[number] | null>((active, candidate) => {
    if (active === null || candidate.page > active.page) return candidate;
    return candidate.page === active.page && candidate.order > active.order ? candidate : active;
  }, null)?.id ?? null;
}

interface OutlineItemsProps {
  items: ResolvedOutlineItem[];
  activeId: string | null;
  parentId: string;
  onNavigate: (page: number) => void;
}

function OutlineItems({ items, activeId, parentId, onNavigate }: OutlineItemsProps) {
  return (
    <ul>
      {items.map((item, index) => {
        const id = `${parentId}/${index}`;
        return (
          <li key={id}>
            <button
              type="button"
              aria-current={id === activeId ? "page" : undefined}
              onClick={() => onNavigate(item.page)}
            >
              {item.title}
            </button>
            {item.children.length > 0 ? (
              <OutlineItems
                items={item.children}
                activeId={activeId}
                parentId={id}
                onNavigate={onNavigate}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export default function PdfOutline({ items, totalPages, currentPage, onNavigate }: PdfOutlineProps) {
  if (items.length > 0) {
    return (
      <nav aria-label="Mục lục PDF">
        <OutlineItems
          items={items}
          activeId={activeOutlineId(items, currentPage)}
          parentId="outline"
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
