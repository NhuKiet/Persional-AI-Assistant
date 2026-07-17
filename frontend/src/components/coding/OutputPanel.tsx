import type { CodingEvent } from "../../hooks/useCoding";

interface OutputPanelProps {
  output: CodingEvent | null;
}

export function OutputPanel({ output }: OutputPanelProps) {
  if (!output) return null;
  const ok = output.exit_code === 0 && !output.timed_out;
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
    </div>
  );
}

//Xem tiến trình
