import type { CSSProperties } from "react";
import { TOOLS, type Tool } from "../config/tools";

interface ToolDockProps {
  onSelect: (tool: Tool) => void;
  visible: boolean;
}

export function ToolDock({ onSelect, visible }: ToolDockProps) {
  return (
    <div className={`dock ${visible ? "dock-visible" : "dock-hidden"}`}>
      {TOOLS.map(tool => (
        <button
          key={tool.id}
          className="dock-item"
          onClick={() => onSelect(tool)}
          title={tool.desc}
          /* --tint cấp màu của tool cho CSS (viền + quầng sáng khi hover).
             React không có kiểu cho custom property nên phải ép kiểu. */
          style={{ "--tint": tool.color } as CSSProperties}
        >
          <span className="dock-icon">{tool.icon}</span>
          <span className="dock-label">{tool.label}</span>
        </button>
      ))}
    </div>
  );
}
