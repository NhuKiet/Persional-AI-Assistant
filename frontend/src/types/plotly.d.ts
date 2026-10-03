// The slice of plotly.js the coding artifact viewer uses (components/coding/PlotlyChart.tsx).
declare module "plotly.js-dist-min" {
  interface PlotlyStatic {
    newPlot(element: HTMLElement, data: unknown[], layout?: Record<string, unknown>, config?: Record<string, unknown>): Promise<unknown>;
    purge(element: HTMLElement): void;
  }
  const Plotly: PlotlyStatic;
  export default Plotly;
}
