import { useState, type ReactElement } from "react";
import { Markdown } from "../../components/Markdown";
import { BarChart, type ChartData } from "../../components/research/BarChart";
import { DeepDiveModal, type DiveSource } from "../../components/research/DeepDiveModal";
import { HPanel } from "../../components/research/HPanel";
import { KeyPoint } from "../../components/research/KeyPoint";
import { PaperCard, type Paper } from "../../components/research/PaperCard";
import type { ModelSelection } from "../../types";

export interface CompareRow {
  source: string;
  main_claim: string;
  strength?: string;
  limitation?: string;
}

export interface ReferenceItem {
  source: string;
  title?: string;
  url: string;
  id?: string;
}

export interface Claim {
  text: string;
  source_ids: string[];
  evidence_type: string;
}

/** Typed from what this component itself reads off the backend's research
 *  result — the Python backend's full response schema isn't formalized
 *  anywhere else in the repo. */
export interface ResearchResultData {
  key_points?: string[];
  query?: string;
  comparison_table?: CompareRow[];
  chart_data?: ChartData;
  follow_up_questions?: string[];
  papers?: Paper[];
  references?: ReferenceItem[];
  summary_detailed?: string;
  summary_medium?: string;
  summary_short?: string;
  claims?: Claim[];
  confidence?: number | null;
  limitations?: string[];
}

function confidenceLabel(c?: number | null): string | null {
  if (c == null) return null;
  if (c >= 0.66) return "Cao";
  if (c >= 0.33) return "Trung bình";
  return "Thấp";
}

interface ResearchResultProps {
  result: ResearchResultData;
  model: ModelSelection | null;
}

interface Panel {
  label: string;
  content: ReactElement;
}

export function ResearchResult({ result, model }: ResearchResultProps) {
  const accentColor = "#7C9EFF";
  const [diveSource, setDiveSource] = useState<DiveSource | null>(null);

  const validKPs = (result.key_points || []).filter(kp =>
    /^\[(FINDING|METHOD|DATA|TREND|LIMITATION|DEFINITION)\]/.test(kp) && kp.length > 20
  );

  const realCompareRows = (result.comparison_table || []).filter(r => r.source && r.main_claim);
  const showCompare = realCompareRows.length >= 2;

  const confLabel = confidenceLabel(result.confidence);
  const claims = result.claims || [];

  const rawPanels: (Panel | false | undefined)[] = [
    result.chart_data && {
      label: "Chart",
      content: <BarChart data={result.chart_data} accentColor={accentColor} />
    },
    validKPs.length >= 3 && {
      label: `Key Points (${validKPs.length})`,
      content: <ul className="kp-list">{validKPs.map((kp, i) => <KeyPoint key={i} text={kp} />)}</ul>
    },
    !!result.papers?.length && {
      label: `Papers (${result.papers.length})`,
      content: <div className="papers-grid">{result.papers.map((p, i) => <PaperCard key={i} paper={p} onDeepDive={setDiveSource} />)}</div>
    },
    showCompare && {
      label: `Compare (${realCompareRows.length})`,
      content: (
        <div className="cmp-table">
          {realCompareRows.map((row, i) => (
            <div key={i} className="cmp-row">
              <div className="cmp-title">{row.source}</div>
              <div className="cmp-claim">{row.main_claim}</div>
              <div className="cmp-meta">
                {row.strength && <span className="cmp-good">+ {row.strength}</span>}
                {row.limitation && <span className="cmp-bad">− {row.limitation}</span>}
              </div>
            </div>
          ))}
        </div>
      )
    },
    !!result.references?.length && {
      label: `Sources (${result.references.length})`,
      content: (
        <div className="ref-list">
          {result.references.map((r, i) => (
            <div key={i} className="ref-item-wrap">
              <a href={r.url} target="_blank" rel="noreferrer" className="ref-item">
                <span className="ref-source">{r.source}</span>
                <span className="ref-title">{r.title || r.url}</span>
                <span className="ref-arrow">↗</span>
              </a>
              <button className="ref-dive-btn" title="Deep dive into this source"
                onClick={() => setDiveSource(r)}>🔍</button>
            </div>
          ))}
        </div>
      )
    },
  ];
  const panels = rawPanels.filter((p): p is Panel => Boolean(p));

  return (
    <div className="rr-wrap">
      <div className="rr-main">
        <div className="rr-ai-header">
          <span className="rr-icon" style={{ color: accentColor }}>◆</span>
          <span className="rr-ai-label">KiNg Research</span>
        </div>
        <div className="rr-body">
          <Markdown text={result.summary_detailed || result.summary_medium || result.summary_short || ""} />
        </div>
        {(!!claims.length || !!confLabel || !!result.limitations?.length) && (
          <div className="claims-list">
            {confLabel && (
              <div className="claim-confidence">
                Độ tin cậy: <span className={`conf-badge conf-${confLabel === "Cao" ? "high" : confLabel === "Trung bình" ? "mid" : "low"}`}>{confLabel}</span>
              </div>
            )}
            {!!claims.length && (
              <ul className="claim-items">
                {claims.map((claim, i) => (
                  <li key={i} className="claim-item">
                    <div className="claim-text">{claim.text}</div>
                    <div className="claim-sources">
                      {claim.source_ids.map(sid => {
                        const ref = result.references?.find(r => r.id === sid);
                        if (!ref) return null;
                        return (
                          <a key={sid} href={ref.url} target="_blank" rel="noreferrer" className="claim-source-chip">
                            {ref.title || ref.url}
                          </a>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {!!result.limitations?.length && (
              <div className="claim-limitations">
                <div className="claim-limitations-label">Hạn chế:</div>
                <ul>
                  {result.limitations.map((lim, i) => <li key={i}>{lim}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
      {panels.length > 0 && (
        <div className="rr-panels">
          {panels.map((panel, i) => (
            <HPanel key={i} label={panel.label} accentColor={accentColor}>
              {panel.content}
            </HPanel>
          ))}
        </div>
      )}
      {diveSource && <DeepDiveModal source={diveSource} onClose={() => setDiveSource(null)} model={model} />}
    </div>
  );
}
