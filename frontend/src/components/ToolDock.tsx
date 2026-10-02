import type { CSSProperties } from "react";
import { VISIBLE_TOOLS, type Tool } from "../config/tools";
import { useAuth } from "../hooks/useAuth";
import { canUse } from "../lib/auth";
import { ToolIcon } from "./ToolIcon";

interface ToolDockProps {
  onSelect: (tool: Tool) => void;
  visible: boolean;
}

export function ToolDock({ onSelect, visible }: ToolDockProps) {
  const { state } = useAuth();
  return (
    <div className={`dock ${visible ? "dock-visible" : "dock-hidden"}`}>
      {VISIBLE_TOOLS.map(tool => {
        // Still clickable: the page explains and offers to sign in.
        const locked = !canUse(state, tool.id);
        return (
        <button
          key={tool.id}
          className={`dock-item${locked ? " is-locked" : ""}`}
          onClick={() => onSelect(tool)}
          title={tool.desc}
          aria-label={locked ? `${tool.label} (cần đăng nhập)` : undefined}
          /* --tint cấp màu của tool cho CSS (viền + quầng sáng khi hover).
             React không có kiểu cho custom property nên phải ép kiểu. */
          style={{ "--tint": tool.color } as CSSProperties}
        >
          <span className="dock-icon"><ToolIcon tool={tool.id} />{locked && <svg className="dock-lock" width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="10.5" width="14" height="9.5" rx="2.2" stroke="currentColor" strokeWidth="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}</span>
          <span className="dock-label">{tool.label}</span>
        </button>
        );
      })}
    </div>
  );
}
