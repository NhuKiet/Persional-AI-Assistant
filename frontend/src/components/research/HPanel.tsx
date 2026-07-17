import { useState, type ReactNode } from "react";

interface HPanelProps {
  label: string;
  accentColor?: string;
  children: ReactNode;
}

export function HPanel({ label, accentColor, children }: HPanelProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`hp-wrap ${open ? "hp-open" : ""}`}>
      <button className="hp-trigger" onClick={() => setOpen(o => !o)}>
        <span className="hp-label">{label}</span>
        <span className="hp-arrow" style={{ color: open ? accentColor : undefined }}>{open ? "↑" : "↓"}</span>
      </button>
      {open && <div className="hp-body">{children}</div>}
    </div>
  );
}
