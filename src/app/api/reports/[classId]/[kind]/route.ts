import { NextResponse } from 'next/server';
import { ApiAuthError, requireApiPermission } from '@/lib/auth/session';
import { isReportKind, loadClassReport } from '@/lib/data/reports';
import { parseRange } from '@/lib/reports/range';
import { csvFilename, toCsv } from '@/lib/reports/csv';

/**
 * Download one report as CSV.
 *
 *   GET /api/reports/:classId/:kind?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Guarded by the same permission as the page, and then by the same
 * getVisibleClass() check inside loadClassReport() — so the link a teacher
 * sees and the endpoint behind it can never disagree about what they may
 * download. The page renders a plain <a> to this route: no client fetch, no
 * blob, and the browser's own download UI handles large files.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ classId: string; kind: string }> }
) {
  try {
    const session = await requireApiPermission('reports:read');
    const { classId, kind } = await params;

    if (!isReportKind(kind)) {
      return NextResponse.json({ error: `Unknown report "${kind}".` }, { status: 404 });
    }

    const url = new URL(request.url);
    const range = parseRange({
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
    });

    const report = await loadClassReport(session, classId, kind, range);
    // Absent and forbidden are answered identically: a teacher must not be
    // able to probe for class ids that exist but are not theirs.
    if (!report) {
      return NextResponse.json({ error: 'Class not found.' }, { status: 404 });
    }

    const rows = report.totalsRow ? [...report.rows, report.totalsRow] : report.rows;
    const csv = toCsv(report.columns, rows);

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${csvFilename(
          report.className,
          kind,
          range.fromISO,
          range.toISO
        )}"`,
        // Student data: never let a shared cache hold on to it.
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
