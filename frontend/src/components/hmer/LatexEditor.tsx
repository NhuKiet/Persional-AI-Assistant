import { useRef } from "react";
import { locateToken, type DoubtfulToken } from "../../lib/hmerDoubt";

interface LatexEditorProps {
  /** What is in the box now. */
  value: string;
  /** What the model read — the reset target and the frame the spans refer to. */
  original: string;
  onChange: (value: string) => void;
  doubtful: DoubtfulToken[];
}

/** The recognized LaTeX, editable in place. The model gets roughly half of
 *  all expressions right, so the usual next step after recognition is fixing
 *  one or two symbols; the doubtful-symbol chips say which ones to check and
 *  select them in the box. */
export function LatexEditor({ value, original, onChange, doubtful }: LatexEditorProps) {
  const box = useRef<HTMLTextAreaElement>(null);
  const edited = value !== original;

  const select = (t: DoubtfulToken) => {
    const el = box.current;
    if (!el) return;
    el.focus();
    const at = locateToken(value, original, t.span, t.token);
    if (at) el.setSelectionRange(at[0], at[1]);
  };

  return (
    <div className="hmer-editor">
      {doubtful.length > 0 && (
        <div className="hmer-doubt">
          <span className="hmer-doubt-label">Mô hình ít chắc ở:</span>
          {doubtful.map((t) => (
            <button
              key={t.index}
              type="button"
              className="hmer-doubt-chip"
              onClick={() => select(t)}
              aria-label={`Chọn ký hiệu ${t.token} trong ô LaTeX, xác suất ${t.prob.toFixed(2)}`}
            >
              <code>{t.token}</code>
              <span className="hmer-doubt-prob">{t.prob.toFixed(2)}</span>
            </button>
          ))}
        </div>
      )}

      <textarea
        ref={box}
        className="hmer-code"
        aria-label="LaTeX (sửa được)"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={Math.min(8, Math.max(2, value.split("\n").length))}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />

      {edited && (
        <div className="hmer-edit-state">
          <span>Đã sửa so với bản mô hình đọc.</span>
          <button type="button" className="hmer-link-btn" onClick={() => onChange(original)}>
            Khôi phục bản mô hình đọc
          </button>
        </div>
      )}
    </div>
  );
}

export default LatexEditor;
