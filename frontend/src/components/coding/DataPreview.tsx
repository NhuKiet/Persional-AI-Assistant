/** `table` of an upload response (backend/app/features/coding/data_preview.py). */
export interface DataTable {
  columns: { name: string; type: string }[];
  rows: (string | number | boolean | null)[][];
  total_rows: number;
  total_columns: number;
  sheet?: string;
}

const NUMERIC = new Set(["int", "float"]);

function count(n: number): string {
  return n.toLocaleString("vi-VN");
}

/** The first rows of an uploaded data file with its column names and
 *  types — the look you take before asking for an analysis, and a check
 *  that the file was read the way you meant (delimiter, header row). */
export function DataPreview({ table, name }: { table: DataTable; name: string }) {
  const { columns, rows, total_rows: totalRows, total_columns: totalColumns } = table;
  const hiddenRows = totalRows - rows.length;
  const hiddenColumns = totalColumns - columns.length;

  return (
    <div className="data-preview">
      <p className="data-preview-meta">
        {count(totalRows)} dòng × {count(totalColumns)} cột
        {table.sheet ? ` · ${table.sheet}` : ""}
        {hiddenColumns > 0 ? ` · hiện ${columns.length} cột đầu` : ""}
      </p>
      <div className="data-preview-scroll" tabIndex={0} role="region" aria-label={`Xem trước ${name}`}>
        <table className="data-preview-table">
          <thead>
            <tr>
              {columns.map((column, i) => (
                <th key={i} scope="col" className={NUMERIC.has(column.type) ? "is-num" : undefined}>
                  <span className="dp-name">{column.name || <em>(không tên)</em>}</span>
                  <span className="dp-type">{column.type}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className={NUMERIC.has(columns[c]?.type) ? "is-num" : undefined}>
                    {cell === null || cell === "" ? <span className="dp-empty" aria-label="trống">—</span> : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hiddenRows > 0 && <p className="data-preview-more">… và {count(hiddenRows)} dòng nữa</p>}
    </div>
  );
}
