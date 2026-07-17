export interface ChartData {
  title?: string;
  labels: string[];
  values: number[];
  unit?: string;
}

interface BarChartProps {
  data: ChartData | null | undefined;
  accentColor: string;
}

export function BarChart({ data, accentColor }: BarChartProps) {
  if (!data?.labels?.length) return null;
  const max = Math.max(...data.values, 1);
  return (
    <div className="chart-wrap">
      <p className="chart-title">{data.title}</p>
      <div className="chart-bars">
        {data.labels.map((label, i) => (
          <div key={i} className="chart-row">
            <span className="chart-label">{label}</span>
            <div className="chart-track">
              <div className="chart-fill" style={{ width: `${(data.values[i] / max) * 100}%`, background: accentColor, animationDelay: `${i * 80}ms` }} />
            </div>
            <span className="chart-val">{data.values[i]}{data.unit ? ` ${data.unit}` : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
