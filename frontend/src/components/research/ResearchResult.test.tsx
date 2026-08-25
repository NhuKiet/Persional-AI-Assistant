import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ResearchResult } from "./ResearchResult";

describe("ResearchResult — grounded claims, source chips, confidence, limitations", () => {
  it("renders claims with source chips, confidence label and limitations", () => {
    const result = {
      query: "q",
      summary_short: "s", summary_medium: "", summary_detailed: "",
      key_points: [], comparison_table: [], chart_data: undefined,
      papers: [], follow_up_questions: [],
      references: [{ source: "web", title: "Source A", url: "http://a", id: "id-a" }],
      claims: [{ text: "Grounded claim", source_ids: ["id-a"], evidence_type: "direct" }],
      confidence: 0.8,
      limitations: ["Chỉ 1 nguồn"],
    };
    render(<ResearchResult result={result as any} model={null} />);
    expect(screen.getByText(/Grounded claim/)).toBeInTheDocument();
    expect(screen.getByText(/Source A/)).toBeInTheDocument();     // chip nguồn
    expect(screen.getByText(/Cao/)).toBeInTheDocument();          // confidence label
    expect(screen.getByText(/Chỉ 1 nguồn/)).toBeInTheDocument();  // limitation
  });

  it("shows confidence label and limitations even when claims is empty", () => {
    const result = {
      query: "q",
      summary_short: "s", summary_medium: "", summary_detailed: "",
      key_points: [], comparison_table: [], chart_data: undefined,
      papers: [], follow_up_questions: [],
      references: [],
      claims: [],
      confidence: 0,
      limitations: ["Tất cả nhận định đều không có nguồn hỗ trợ"],
    };
    render(<ResearchResult result={result as any} model={null} />);
    expect(screen.getByText(/Thấp/)).toBeInTheDocument();
    expect(screen.getByText(/Tất cả nhận định đều không có nguồn hỗ trợ/)).toBeInTheDocument();
  });

  it("renders without claims (backward compatible)", () => {
    const result = {
      query: "q", summary_short: "s", summary_medium: "", summary_detailed: "",
      key_points: [
        "[FINDING] something interesting here to render",
        "[METHOD] a second valid key point long enough to pass",
        "[DATA] a third valid key point long enough to pass",
      ],
      comparison_table: [], chart_data: undefined, papers: [],
      references: [], follow_up_questions: [],
    };
    render(<ResearchResult result={result as any} model={null} />);
    // HPanel content is collapsed by default; assert the existing panel still renders as before.
    expect(screen.getByText("Key Points (3)")).toBeInTheDocument();
  });

  it("hides the Compare panel for legacy sessions whose rows carry the deleted fallback's signature", () => {
    const result = {
      query: "q", summary_short: "s", summary_medium: "", summary_detailed: "",
      key_points: [], chart_data: undefined, papers: [],
      references: [], follow_up_questions: [],
      comparison_table: [
        { source: "web", type: "web", main_claim: "First 150 chars of the source text...", strength: "web source", limitation: "See full source for details" },
        { source: "wiki", type: "wiki", main_claim: "First 150 chars of another source...", strength: "wiki source", limitation: "See full source for details" },
      ],
    };
    render(<ResearchResult result={result as any} model={null} />);
    expect(screen.queryByText(/Compare/)).not.toBeInTheDocument();
  });

  it("still shows the Compare panel for genuine comparison rows", () => {
    const result = {
      query: "q", summary_short: "s", summary_medium: "", summary_detailed: "",
      key_points: [], chart_data: undefined, papers: [],
      references: [], follow_up_questions: [],
      comparison_table: [
        { source: "web", type: "web", main_claim: "Approach A improves latency by 20%", strength: "Directly measured", limitation: "Small sample size" },
        { source: "wiki", type: "wiki", main_claim: "Approach B improves latency by 10%", strength: "Peer reviewed", limitation: "Older benchmark" },
      ],
    };
    render(<ResearchResult result={result as any} model={null} />);
    expect(screen.getByText(/Compare/)).toBeInTheDocument();
  });
});
