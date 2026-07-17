import { EVENT_DISPLAY } from "../../config/eventDisplay";
import type { CodingEvent } from "../../hooks/useCoding";

interface EventRowProps {
  ev: CodingEvent;
  accentColor: string;
}

export function EventRow({ ev, accentColor }: EventRowProps) {
  const cfg = EVENT_DISPLAY[ev.type];
  if (!cfg) return null;  // ẩn các event không cần hiển thị

  const isOutput  = ev.type === "output";
  const isDone    = ev.type === "done";
  const isOk      = isOutput ? ev.exit_code === 0 : (isDone ? ev.success : null);
  const iconColor = cfg.color || (isOk === true ? accentColor : isOk === false ? "#FF8585" : accentColor);
  const icon      = cfg.icon  || (isOk === true ? "✓" : isOk === false ? "✗" : "·");

  return (
    <div className={`event-row ${isOutput && !isOk ? "event-row-err" : ""}`}>
      <span className="event-icon" style={{ color: iconColor }}>{icon}</span>
      <span className="event-label">{cfg.label(ev)}</span>
    </div>
  );
}


// ─── PDF Chat page ────────────────────────────────────────────────────────────
