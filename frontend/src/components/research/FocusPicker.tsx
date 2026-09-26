import type { ResearchFocus } from "../../hooks/useResearch";

const FOCUSES: { value: ResearchFocus; label: string; sources: string }[] = [
  { value: "all", label: "Tất cả", sources: "Web, DuckDuckGo, arXiv, Semantic Scholar, HF Papers, Stack Overflow" },
  { value: "academic", label: "Học thuật", sources: "arXiv, Semantic Scholar, HF Papers" },
  { value: "web", label: "Web", sources: "Web (Tavily), DuckDuckGo" },
  { value: "code", label: "Code", sources: "Stack Overflow, Web" },
];

interface FocusPickerProps {
  value: ResearchFocus;
  onChange: (focus: ResearchFocus) => void;
}

/** Which sources a research run searches. Native radios, so arrow keys and
 *  screen readers work as they do for any radio group. */
export function FocusPicker({ value, onChange }: FocusPickerProps) {
  return (
    <div className="focus-picker" role="radiogroup" aria-label="Nguồn tìm kiếm">
      <span className="focus-picker-label" aria-hidden="true">Nguồn</span>
      {FOCUSES.map((f) => (
        <label key={f.value} className="focus-option" title={`Tìm trong: ${f.sources}`}>
          <input
            type="radio"
            name="research-focus"
            value={f.value}
            checked={value === f.value}
            onChange={() => onChange(f.value)}
          />
          <span>{f.label}</span>
        </label>
      ))}
    </div>
  );
}
