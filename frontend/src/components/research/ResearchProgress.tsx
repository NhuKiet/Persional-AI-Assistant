import { SOURCE_LABELS } from "../../config/tools";
import type { ResearchProgressItem } from "../../hooks/useResearch";

interface ResearchProgressProps {
  progress: ResearchProgressItem[];
}

export function ResearchProgress({ progress }: ResearchProgressProps) {
  return (
    <div className="rp-wrap">
      <div className="rp-pulse"><span className="rp-dot" /><span className="rp-dot" /><span className="rp-dot" /></div>
      <div className="rp-sources">
        {progress.map((p) => {
          const meta = SOURCE_LABELS[p.source] || { label: p.source, icon: "·" };
          return (
            <div key={p.source} className={`rp-source ${p.done ? "rp-done" : "rp-active"}`}>
              <span className="rp-icon">{meta.icon}</span>
              <span className="rp-label">{meta.label}</span>
              {p.done && p.count !== null && <span className="rp-count">{p.count}</span>}
              {!p.done && <span className="rp-spinner" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
