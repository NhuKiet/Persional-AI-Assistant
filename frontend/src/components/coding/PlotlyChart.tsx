import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";
import { sanitizeFigure } from "../../lib/plotlyFigure";

/** An interactive chart from the coding agent (hover, zoom, PNG download in
 *  Plotly's toolbar). plotly.js is ~1 MB gzipped, so it loads only when a
 *  chart is actually shown. */
export function PlotlyChart({ url, name }: { url: string; name: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const element = box.current;
    let plotly: { purge(element: HTMLElement): void } | null = null;
    setFailed(false);
    (async () => {
      try {
        const [raw, module] = await Promise.all([
          apiFetch(url).then((response) => (response.ok ? response.json() : null)),
          import("plotly.js-dist-min"),
        ]);
        const figure = sanitizeFigure(raw);
        if (cancelled || !element) return;
        if (!figure) {
          setFailed(true);
          return;
        }
        plotly = module.default;
        await module.default.newPlot(
          element,
          figure.data,
          { ...figure.layout, autosize: true },
          { responsive: true, displaylogo: false },
        );
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (plotly && element) plotly.purge(element);
    };
  }, [url]);

  return (
    <>
      <div ref={box} className="artifact-chart" role="figure" aria-label={`Biểu đồ ${name}`} />
      {failed && <p className="artifact-chart-error">Không đọc được biểu đồ — vẫn có thể tải file JSON xuống.</p>}
    </>
  );
}
