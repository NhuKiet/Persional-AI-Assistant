import { useMemo, useRef, useState } from "react";
import type { HmerExplanation } from "../../lib/hmerApi";

/** "none": there is no map to ask for (the model produced no LaTeX). */
export type EvidenceStatus = "none" | "loading" | "ready" | "error";

interface EvidenceViewProps {
  imageUrl: string;
  alt: string;
  status: EvidenceStatus;
  explanation: HmerExplanation | null;
  error?: string;
}

/** The recognized image, with the regions each token rests on lit over it.
 *
 *  The map comes from occlusion (backend hmer/occlusion.py): hide one cell,
 *  see how much less sure the model gets of each token. It replaced a
 *  cross-attention map that, on this checkpoint, swept left to right whatever
 *  the image — so the copy here says what the light means ("hide it and the
 *  model is less sure"), never that it is *why* the model chose a symbol.
 *
 *  Hover lives on the token strip, not the rendered formula: KaTeX keeps no
 *  mapping from its output back to source tokens. */
export function EvidenceView({ imageUrl, alt, status, explanation, error }: EvidenceViewProps) {
  const [active, setActive] = useState<number | null>(null);
  const chips = useRef<(HTMLButtonElement | null)[]>([]);

  const evidence = status === "ready" ? explanation?.evidence ?? null : null;
  const tokens = status === "ready" ? explanation?.tokens ?? [] : [];

  // Opacity relative to the active token's strongest cell, so a token whose
  // evidence is spread thin still reads as a shape rather than a faint wash.
  const opacities = useMemo(() => {
    if (!evidence) return [];
    const cells = evidence.rows * evidence.cols;
    if (active === null || evidence.no_evidence[active]) return new Array<number>(cells).fill(0);
    const weights = evidence.weights[active];
    const peak = Math.max(...weights);
    return weights.map((w) => (peak > 0 ? w / peak : 0));
  }, [evidence, active]);

  const moveTo = (index: number) => {
    const next = Math.max(0, Math.min(tokens.length - 1, index));
    chips.current[next]?.focus();
    setActive(next);
  };

  const onChipKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveTo(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveTo(index - 1);
    }
  };

  const hint =
    active === null
      ? "Rê chuột hoặc Tab qua từng ký hiệu để xem vùng mô hình dựa vào."
      : evidence?.no_evidence[active]
        ? "Không vùng riêng lẻ nào quyết định ký hiệu này."
        : null;

  return (
    <div className="hmer-evidence">
      <div className="hmer-evidence-frame">
        <img className="hmer-thumb" src={imageUrl} alt={alt} />
        {evidence && (
          <div
            className="hmer-evidence-grid"
            aria-hidden="true"
            style={{
              gridTemplateColumns: `repeat(${evidence.cols}, 1fr)`,
              gridTemplateRows: `repeat(${evidence.rows}, 1fr)`,
            }}
          >
            {opacities.map((opacity, cell) => (
              <span key={cell} className="hmer-evidence-cell" style={{ opacity }} />
            ))}
          </div>
        )}
      </div>

      {status === "loading" && (
        <p className="hmer-evidence-note" role="status">
          <span className="hmer-spinner" aria-hidden="true" />
          Đang tìm vùng mô hình dựa vào…
        </p>
      )}

      {status === "error" && (
        <p className="hmer-evidence-note">
          Không tính được vùng mô hình dựa vào{error ? `: ${error}` : "."}
        </p>
      )}

      {evidence && (
        <>
          <div className="hmer-tokens" role="toolbar" aria-label="Các ký hiệu mô hình đọc được">
            {tokens.map((token, index) => {
              const flat = evidence.no_evidence[index];
              return (
                <button
                  key={index}
                  ref={(el) => {
                    chips.current[index] = el;
                  }}
                  type="button"
                  className={`hmer-token${flat ? " is-flat" : ""}${active === index ? " is-active" : ""}`}
                  aria-pressed={active === index}
                  aria-label={flat ? `${token}, không có vùng riêng` : token}
                  onMouseEnter={() => setActive(index)}
                  onFocus={() => setActive(index)}
                  onKeyDown={(event) => onChipKeyDown(event, index)}
                >
                  {token}
                </button>
              );
            })}
          </div>
          {hint && <p className="hmer-evidence-hint">{hint}</p>}
          <p className="hmer-evidence-caption">
            Vùng sáng: che đi thì mô hình bớt chắc về ký hiệu đang chọn.
          </p>
        </>
      )}
    </div>
  );
}

export default EvidenceView;
