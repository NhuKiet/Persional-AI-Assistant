import { useLayoutEffect, useRef } from "react";
import { locateToken, type DoubtfulToken } from "../../lib/hmerDoubt";

interface Snippet {
  /** On the button. */
  label: string;
  /** Accessible name and tooltip. */
  title: string;
  before: string;
  after: string;
  /** Put between before/after when nothing is selected — then selected, so
   *  typing replaces it. A selection is wrapped instead. */
  placeholder?: string;
}

/** The structures the model gets wrong most often, ready to drop in: the
 *  model reads set braces, row breaks and environments only as loose
 *  backslashes (see lib/hmerLatex.ts), so fixing one by hand means typing
 *  LaTeX that people rarely remember exactly. */
const SNIPPETS: Snippet[] = [
  { label: "\\{ \\}", title: "Ngoặc nhọn (tập hợp) — bọc quanh phần đang chọn", before: "\\{ ", after: " \\}", placeholder: "x" },
  { label: "\\\\", title: "Xuống dòng (trong ma trận, hệ)", before: " \\\\ ", after: "" },
  { label: "&", title: "Sang cột kế tiếp", before: " & ", after: "" },
  { label: "( ma trận )", title: "Ma trận 2×2 trong ngoặc tròn", before: "\\begin{pmatrix} ", placeholder: "a", after: " & b \\\\ c & d \\end{pmatrix}" },
  { label: "[ ma trận ]", title: "Ma trận 2×2 trong ngoặc vuông", before: "\\begin{bmatrix} ", placeholder: "a", after: " & b \\\\ c & d \\end{bmatrix}" },
  { label: "| định thức |", title: "Định thức 2×2", before: "\\begin{vmatrix} ", placeholder: "a", after: " & b \\\\ c & d \\end{vmatrix}" },
  { label: "{ hệ", title: "Hệ phương trình", before: "\\begin{cases} ", placeholder: "x + y = 1", after: " \\\\ x - y = 0 \\end{cases}" },
];

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
  // Where to put the selection once the inserted text has rendered.
  const pendingSelection = useRef<[number, number] | null>(null);

  useLayoutEffect(() => {
    const range = pendingSelection.current;
    if (!range || !box.current) return;
    pendingSelection.current = null;
    box.current.focus();
    box.current.setSelectionRange(range[0], range[1]);
  }, [value]);

  const insert = (snippet: Snippet) => {
    const el = box.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const middle = value.slice(start, end) || snippet.placeholder || "";
    const from = start + snippet.before.length;
    pendingSelection.current = [from, from + middle.length];
    onChange(value.slice(0, start) + snippet.before + middle + snippet.after + value.slice(end));
  };

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

      <div className="hmer-snippets" role="group" aria-label="Chèn cấu trúc">
        {SNIPPETS.map((snippet) => (
          <button
            key={snippet.title}
            type="button"
            className="hmer-snippet"
            title={snippet.title}
            aria-label={snippet.title}
            // Keep the selection in the box: a click would otherwise move focus first.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insert(snippet)}
          >
            <code>{snippet.label}</code>
          </button>
        ))}
      </div>

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
