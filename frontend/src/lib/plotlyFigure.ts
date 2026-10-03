/** A chart the coding agent wrote with fig.write_json('….plotly.json'):
 *  data and layout only, drawn by plotly.js on the page (CHART_SUFFIX in
 *  backend/app/features/coding/artifacts.py). */
export interface PlotlyFigure {
  data: Record<string, unknown>[];
  layout: Record<string, unknown>;
}

const CHART_SUFFIX = ".plotly.json";

export function isChartArtifact(name: string): boolean {
  return name.toLowerCase().endsWith(CHART_SUFFIX);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Inline images only. Generated code can be steered by an uploaded file or
 *  a web page, and an image loaded from a URL would send data out the moment
 *  the chart draws — the same rule as images in answers (MarkdownRenderer). */
function inlineOnly(source: unknown): boolean {
  return typeof source === "string" && source.startsWith("data:image/");
}

/** The figure to draw, or null if `raw` isn't one. */
export function sanitizeFigure(raw: unknown): PlotlyFigure | null {
  if (!isRecord(raw) || !Array.isArray(raw.data)) return null;
  const data = raw.data
    .filter(isRecord)
    .filter((trace) => trace.type !== "image" || !("source" in trace) || inlineOnly(trace.source));
  const layout = isRecord(raw.layout) ? { ...raw.layout } : {};
  if (Array.isArray(layout.images)) {
    layout.images = layout.images.filter((image) => isRecord(image) && inlineOnly(image.source));
  }
  return { data, layout };
}
