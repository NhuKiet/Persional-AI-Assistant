import type { CodingEvent } from "../../hooks/useCoding";

interface OutputPanelProps {
  output: CodingEvent | null;
}

/** A variable the run left defined, which the session's next request can use
 *  (backend/app/features/coding/session_state.py). */
interface KeptVariable {
  name: string;
  summary: string;
}

export function OutputPanel({ output }: OutputPanelProps) {
  if (!output) return null;
  const ok = output.exit_code === 0 && !output.timed_out;
  const kept = (output.kept_variables as KeptVariable[] | undefined) ?? [];
  return (
    <div className={`output-panel ${ok ? "output-ok" : "output-err"}`}>
      <div className="output-header">
        <span className="output-status">
          {output.timed_out ? "⏱ Timeout" : ok ? "✓ Success" : `✗ Exit ${output.exit_code}`}
        </span>
        <span className="output-duration">{output.duration as number}s</span>
      </div>
      {output.stdout ? (
        <pre className="output-pre output-stdout">{output.stdout as string}</pre>
      ) : null}
      {output.stderr ? (
        <pre className="output-pre output-stderr">{output.stderr as string}</pre>
      ) : null}
      {kept.length > 0 && (
        <details className="output-kept">
          <summary>Giữ cho câu hỏi sau: {kept.map(v => v.name).join(", ")}</summary>
          <ul>
            {kept.map(v => (
              <li key={v.name}><code>{v.name}</code> {v.summary}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

//Xem tiến trình
