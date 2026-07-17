import type { CodingPhase } from "../../hooks/useCoding";

interface PhaseBarProps {
  phase: CodingPhase;
  success: boolean | null;
}

export function PhaseBar({ phase, success }: PhaseBarProps) {
  const phases = [
    { id: "thinking",   label: "Phân tích" },
    { id: "planning",   label: "Lập kế hoạch" },
    { id: "generating", label: "Viết code" },
    { id: "executing",  label: "Chạy code" },
    { id: "debugging",  label: "Debug" },
    { id: "testing",    label: "Tests" },
    { id: "reviewing",  label: "Review" },
    { id: "done",       label: "Hoàn thành" },
  ];
  const order  = phases.map(p => p.id);
  const idx    = order.indexOf(phase);

  return (
    <div className="phase-bar">
      {phases.map((p, i) => {
        const done   = i < idx || phase === "done";
        const active = p.id === phase;
        return (
          <div key={p.id} className="phase-step">
            <div className={`phase-dot ${done ? "phase-done" : active ? "phase-active" : "phase-future"}`}>
              {done ? "✓" : active ? <span className="phase-spinner" /> : ""}
            </div>
            <span className={`phase-label ${active ? "phase-label-active" : done ? "phase-label-done" : ""}`}>
              {p.label}
            </span>
            {i < phases.length - 1 && <div className={`phase-line ${done ? "phase-line-done" : ""}`} />}
          </div>
        );
      })}
    </div>
  );
}


//Hiển thị biểu đồ
