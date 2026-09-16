import type { ReportColumn, ReportRow } from '@/lib/reports/rows';

/** The rows exactly as the CSV will contain them — one shape, one source. */
export default function ReportTable({
  columns,
  rows,
  totalsRow,
}: {
  columns: ReportColumn[];
  rows: ReportRow[];
  totalsRow?: ReportRow;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-subtle bg-surface px-4 py-6 text-center text-sm text-muted">
        No records in this date range. Try widening it.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-subtle bg-surface">
      <table className="w-full text-sm">
        <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={`px-3 py-2 font-medium whitespace-nowrap ${
                  column.numeric ? 'text-right' : ''
                }`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-subtle">
          {rows.map((row, index) => (
            <tr key={index} className="hover:bg-surface-muted">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`px-3 py-2 ${column.numeric ? 'text-right tabular-nums' : ''}`}
                >
                  {row[column.key] === '' ? <span className="text-faint">—</span> : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
          {totalsRow && (
            <tr className="border-t-2 border-strong bg-surface-muted font-semibold">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`px-3 py-2 ${column.numeric ? 'text-right tabular-nums' : ''}`}
                >
                  {totalsRow[column.key]}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
