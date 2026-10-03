import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ArtifactView } from "./ArtifactView";

const plotly = vi.hoisted(() => ({ newPlot: vi.fn(async () => undefined), purge: vi.fn() }));
vi.mock("plotly.js-dist-min", () => ({ default: plotly }));

afterEach(() => vi.unstubAllGlobals());

function serveFigure(figure: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(figure), {
    status: 200, headers: { "Content-Type": "application/json" },
  })));
}

it("draws a Plotly chart interactively, from cleaned figure data", async () => {
  serveFigure({
    data: [{ type: "bar", x: ["a", "b"], y: [1, 2] }],
    layout: { title: { text: "Doanh thu" }, images: [{ source: "https://attacker.example/x.png" }] },
  });

  render(<ArtifactView artifacts={["s1/chart.plotly.json"]} />);

  await waitFor(() => expect(plotly.newPlot).toHaveBeenCalledTimes(1));
  const [element, data, layout, config] = plotly.newPlot.mock.calls[0] as unknown as [HTMLElement, unknown, Record<string, unknown>, Record<string, unknown>];
  expect(element).toBe(screen.getByRole("figure", { name: "Biểu đồ chart.plotly.json" }));
  expect(data).toEqual([{ type: "bar", x: ["a", "b"], y: [1, 2] }]);
  expect(layout.images).toEqual([]);
  expect(config).toMatchObject({ displaylogo: false, responsive: true });
  expect(screen.getByRole("link", { name: /Tải xuống/ })).toHaveAttribute("href", "/api/coding/artifact/s1/chart.plotly.json");
});

it("says so when the chart can't be read", async () => {
  serveFigure("not a figure");

  render(<ArtifactView artifacts={["s1/chart.plotly.json"]} />);

  expect(await screen.findByText(/Không đọc được biểu đồ/)).toBeInTheDocument();
});

it("still shows images as images", () => {
  render(<ArtifactView artifacts={["s1/plot.png"]} />);

  expect(screen.getByRole("img", { name: "s1/plot.png" })).toHaveAttribute("src", "/api/coding/artifact/s1/plot.png");
});
