import { useState } from "react";
import { API } from "../../lib/api";

interface ArtifactViewProps {
  artifacts: string[];
}

export function ArtifactView({ artifacts }: ArtifactViewProps) {
  const [selected, setSelected] = useState(0);
  if (!artifacts?.length) return null;

  const current = artifacts[selected];
  const isHtml  = current.endsWith(".html");
  const url     = `${API}/api/coding/artifact/${current}`;

  return (
    <div className="artifact-wrap">
      {artifacts.length > 1 && (
        <div className="artifact-strip">
          {artifacts.map((name, i) => (
            <button key={name} className={`artifact-thumb ${i === selected ? "artifact-thumb-active" : ""}`}
              onClick={() => setSelected(i)}>
              {name.endsWith(".html") ? "📊" : "🖼"} {name}
            </button>
          ))}
        </div>
      )}

      <div className="artifact-viewer">
        {isHtml ? (
          <iframe src={url} className="artifact-iframe" title={current} sandbox="allow-scripts" />
        ) : (
          <img src={url} alt={current} className="artifact-img" />
        )}
        <div className="artifact-footer">
          <span className="artifact-name">{current}</span>
          <a href={url} download={current} className="artifact-dl">⬇ Tải xuống</a>
        </div>
      </div>
    </div>
  );
}

//Khung kết quả của coding agent
