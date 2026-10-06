export interface ToolbarPos {
  x: number;
  y: number;
}

interface SelectionToolbarProps {
  pos: ToolbarPos | null | undefined;
  onAction: (action: string) => void;
  onClose: () => void;
}

export default function SelectionToolbar({ pos, onAction, onClose }: SelectionToolbarProps) {
  if (!pos) return null;
  const btn = (a: string, label: string) => (
    <button className="sel-tb-btn" onMouseDown={(e) => { e.preventDefault(); onAction(a); }}>
      {label}
    </button>
  );
  return (
    // Only keeps a press on the toolbar from reaching the selection layer
    // underneath; the actions themselves are the buttons inside.
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="sel-toolbar" style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()}>
      {btn("explain", "Giải thích")}
      {btn("discuss", "Thảo luận")}
      {btn("translate", "Dịch")}
      {btn("pin", "+ Ghim")}
      <button className="sel-tb-close" onMouseDown={(e) => { e.preventDefault(); onClose(); }}>✕</button>
    </div>
  );
}
