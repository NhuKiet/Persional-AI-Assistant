import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { FocusPicker } from "./FocusPicker";
import { ResearchPage } from "../../pages/ResearchPage";

describe("FocusPicker", () => {
  it("offers the four focuses as one radio group", () => {
    render(<FocusPicker value="all" onChange={() => {}} />);

    const group = screen.getByRole("radiogroup", { name: "Nguồn tìm kiếm" });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole("radio").map((r) => r.getAttribute("value"))).toEqual(["all", "academic", "web", "code"]);
    expect(screen.getByRole("radio", { name: /Tất cả/ })).toBeChecked();
  });

  it("says which sources each focus searches", () => {
    render(<FocusPicker value="all" onChange={() => {}} />);

    expect(screen.getByRole("radio", { name: /Học thuật/ }).closest("label")).toHaveAttribute(
      "title", expect.stringMatching(/arXiv.*Semantic Scholar/),
    );
  });

  it("reports the chosen focus", () => {
    const onChange = vi.fn();
    render(<FocusPicker value="all" onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: /Code/ }));

    expect(onChange).toHaveBeenCalledWith("code");
  });
});

describe("ResearchPage source focus", () => {
  function mockBackend() {
    const researchBodies: Record<string, unknown>[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/api/research/stream")) {
        researchBodies.push(JSON.parse(String(init?.body)));
        return new Response('data: {"type":"done","data":{"query":"q"}}\n\n', { status: 200 });
      }
      if (u.includes("/api/models")) {
        return new Response(JSON.stringify({ models: [], default: { provider: "ollama", model: "llama3" } }));
      }
      return new Response(JSON.stringify({ suggestions: [] }));
    }) as typeof fetch);
    return researchBodies;
  }

  it("searches with the chosen focus and remembers it", async () => {
    const bodies = mockBackend();
    render(<MemoryRouter><ResearchPage /></MemoryRouter>);

    fireEvent.click(await screen.findByRole("radio", { name: /Học thuật/ }));
    const box = screen.getByPlaceholderText("Nhập chủ đề nghiên cứu…");
    fireEvent.change(box, { target: { value: "diffusion models" } });
    fireEvent.keyDown(box, { key: "Enter" });

    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ query: "diffusion models", focus: "academic" });
    expect(localStorage.getItem("king_research_focus")).toBe("academic");
  });

  it("starts from the remembered focus", async () => {
    localStorage.setItem("king_research_focus", "code");
    mockBackend();
    render(<MemoryRouter><ResearchPage /></MemoryRouter>);

    expect(await screen.findByRole("radio", { name: /Code/ })).toBeChecked();
  });
});
