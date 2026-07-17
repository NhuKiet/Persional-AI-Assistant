import { useState, useEffect } from "react";
import { CodeBlock } from "../../components/CodeBlock";
import { Markdown } from "../../components/Markdown";
import { ArtifactView } from "../../components/coding/ArtifactView";
import { OutputPanel } from "../../components/coding/OutputPanel";
import { PlanView } from "../../components/coding/PlanView";
import type { CodingEvent, CodingPhase, InstallingState, PlanStep } from "../../hooks/useCoding";

interface CodingResultProps {
  codes: CodingEvent[];
  output: CodingEvent | null;
  artifacts: string[];
  plan: PlanStep[] | null;
  phase: CodingPhase;
  finalMsg: string;
  success: boolean | null;
  planStream: string;
  codeStream: string;
  installing: InstallingState | null;
  testOutput: CodingEvent | null;
  review: string | null;
}

export function CodingResult({ codes, output, artifacts, plan, phase, finalMsg, success, planStream, codeStream, installing, testOutput, review }: CodingResultProps) {
  const [activeTab, setActiveTab] = useState("code");

  useEffect(() => {
    if (artifacts?.length) setActiveTab("artifacts");
    else if (output) setActiveTab("output");
  }, [output, artifacts]);
  useEffect(() => { if (testOutput) setActiveTab("tests"); }, [testOutput]);
  useEffect(() => { if (review) setActiveTab("review"); }, [review]);
  useEffect(() => { if (planStream && !plan) setActiveTab("plan"); }, [planStream, plan]);
  useEffect(() => { if (codeStream && !codes.length) setActiveTab("code"); }, [codeStream]);

  const tabs = [
    { id: "plan",      label: `📋 Kế hoạch (${plan?.length || 0})`,  show: !!plan?.length || !!planStream },
    { id: "code",      label: `💻 Code (${codes.length})`,            show: !!codes.length || !!codeStream },
    { id: "output",    label: "📤 Output",                            show: !!output },
    { id: "artifacts", label: `📊 Biểu đồ (${artifacts?.length || 0})`, show: !!artifacts?.length },
    { id: "tests",     label: `🧪 Tests`,                             show: !!testOutput },
    { id: "review",    label: `🧠 Review`,                            show: !!review },
  ].filter(t => t.show);

  if (!tabs.length) return null;

  return (
    <div className="coding-result">
      <div className="result-tabs">
        {tabs.map(t => (
          <button
            key={t.id}
            className={`result-tab ${activeTab === t.id ? "result-tab-active" : ""}`}
            onClick={() => setActiveTab(t.id)}
          >{t.label}</button>
        ))}
      </div>
      <div className="result-body">
        {activeTab === "plan" && (plan?.length
          ? <PlanView steps={plan} currentPhase={phase} />
          : (
            /* Plan chưa parse xong: hiện token JSON đang chảy về, để người dùng
               thấy agent đang lập kế hoạch thay vì chờ khối im lặng. Khi "plan"
               có cấu trúc tới, khối này được thay bằng PlanView ở trên. */
            <div className="code-stream-preview">
              <div className="code-stream-label">🧠 Đang lập kế hoạch...</div>
              <pre className="code-stream-pre">{planStream}</pre>
            </div>
          ))}
        {activeTab === "code" && codes.map((c, i) => (
          <CodeBlock key={i} code={c.content as string} language={c.language as string} filename={c.filename as string} isFix={c.is_fix as boolean} iteration={c.iteration as number} />
        ))}
        {activeTab === "output" && (
          <>
            <OutputPanel output={output} />
            {finalMsg && (
              <div className={`final-msg ${success ? "final-ok" : "final-fail"}`}>
                {finalMsg}
              </div>
            )}
          </>
        )}
        {activeTab === "artifacts" && (
          <ArtifactView artifacts={artifacts} />
        )}
        {activeTab === "code" && !codes.length && codeStream && (
          <div className="code-stream-preview">
            <div className="code-stream-label">⚡ Đang viết code...</div>
            <pre className="code-stream-pre">{codeStream}</pre>
          </div>
        )}
        {activeTab === "tests" && testOutput && (
          <div className={`test-panel ${testOutput.success ? "test-pass" : "test-fail"}`}>
            <div className="test-header">{testOutput.success ? "✅ Tests passed" : "❌ Tests failed"}</div>
            <pre className="test-output">{(testOutput.stdout || testOutput.stderr) as string}</pre>
          </div>
        )}
        {activeTab === "review" && review && (
          <div className="review-panel"><Markdown text={review} /></div>
        )}
        {installing && (
          <div className="install-banner">
            📦 {installing.message}
          </div>
        )}
      </div>
    </div>
  );
}

//Bar chart
