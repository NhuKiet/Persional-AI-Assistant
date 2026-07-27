export interface Paper {
  source?: string;
  year?: number;
  citation_count?: number;
  title: string;
  authors?: string[];
  snippet?: string;
  url?: string;
}

interface PaperCardProps {
  paper: Paper;
  onDeepDive?: (paper: Paper) => void;
}

export function PaperCard({ paper, onDeepDive }: PaperCardProps) {
  const sourceColor = ({ arxiv: "#7C9EFF", semantic_scholar: "#A8E6A3", huggingface: "#FFB085", stackoverflow: "#B8E0B8" } as Record<string, string>)[paper.source || ""] || "#888";
  return (
    <div className="paper-card" onClick={() => onDeepDive?.(paper)} style={{ cursor: "pointer" }} title="Click to deep dive">
      <div className="paper-top">
        <span className="paper-source" style={{ color: sourceColor, borderColor: sourceColor + "44" }}>{paper.source?.replace("_", " ")}</span>
        {paper.year && <span className="paper-year">{paper.year}</span>}
        {(paper.citation_count ?? 0) > 0 && <span className="paper-cites">↑ {paper.citation_count}</span>}
        <span className="paper-dive-hint">🔍 Deep dive</span>
      </div>
      <p className="paper-title">{paper.title}</p>
      {paper.authors?.length ? <p className="paper-authors">{paper.authors.slice(0, 3).join(", ")}{paper.authors.length > 3 ? " et al." : ""}</p> : null}
      {paper.snippet && <p className="paper-snippet">{paper.snippet}</p>}
      <div className="paper-actions">
        {paper.url && <a href={paper.url} target="_blank" rel="noreferrer" className="paper-link" onClick={e => e.stopPropagation()}>View ↗</a>}
        <button className="paper-dive-btn" style={{ color: sourceColor, borderColor: sourceColor + "55" }}
          onClick={e => { e.stopPropagation(); onDeepDive?.(paper); }}>🔍 Deep dive</button>
      </div>
    </div>
  );
}
