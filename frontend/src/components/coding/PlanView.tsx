import type { CodingPhase, PlanStep } from "../../hooks/useCoding";

interface PlanViewProps {
  steps: PlanStep[] | null;
  currentPhase: CodingPhase;
}

export function PlanView({ steps, currentPhase }: PlanViewProps) {
  if (!steps?.length) return null;
  const donePhases = ["executing", "debugging", "done"];
  return (
    <div className="plan-wrap">
      {steps.map((s, i) => (
        <div key={i} className="plan-step">
          <div className={`plan-num ${donePhases.includes(currentPhase) || i < steps.length - 1 ? "plan-num-done" : "plan-num-active"}`}>
            {donePhases.includes(currentPhase) || i < steps.length - 1 ? "✓" : s.step}
          </div>
          <div className="plan-body">
            <div className="plan-title">{s.title}</div>
            <div className="plan-desc">{s.description}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

//Thanh trạng thái khi coding agent chạy
