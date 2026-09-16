import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requirePermission } from '@/lib/auth/session';
import { listVisibleClasses } from '@/lib/data/classes';
import {
  REPORT_KINDS,
  REPORT_LABELS,
  isReportKind,
  loadClassReport,
  type ReportKind,
} from '@/lib/data/reports';
import { MAX_RANGE_DAYS, formatRangeLabel, parseRange } from '@/lib/reports/range';
import { reportHref, type ReportParams } from '@/lib/reports/query';
import DateRangeForm from './date-range-form';
import ReportTable from './report-table';

export const dynamic = 'force-dynamic';

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const session = await requirePermission('reports:read');
  const raw = await searchParams;

  const classes = await listVisibleClasses(session);
  const requestedClassId = first(raw.classId);
  // With exactly one class there is nothing to choose, so don't make them.
  const classId = requestedClassId ?? (classes.length === 1 ? classes[0].id : undefined);

  const range = parseRange({ from: first(raw.from), to: first(raw.to) });
  const kind: ReportKind = isReportKind(first(raw.kind)) ? (first(raw.kind) as ReportKind) : 'attendance';

  /**
   * Canonicalize the URL once, so `from` and `to` are always spelled out.
   *
   * This matters beyond tidiness: the header class picker copies whatever
   * parameters it finds, so if the dates were implicit they could silently
   * shift under it as "today" moves. parseRange() is idempotent on its own
   * output, so this redirect cannot loop.
   */
  if (classId) {
    const needsCanonical =
      first(raw.from) !== range.fromISO ||
      first(raw.to) !== range.toISO ||
      first(raw.kind) !== kind ||
      requestedClassId !== classId;
    if (needsCanonical) {
      redirect(
        reportHref(
          {},
          {
            classId,
            from: range.fromISO,
            to: range.toISO,
            kind,
            // Survives this one redirect so the page can say the range was
            // capped; withParams() drops it from every link thereafter.
            trimmed: range.clamped ? '1' : undefined,
          }
        )
      );
    }
  }

  const params: ReportParams = { classId, from: range.fromISO, to: range.toISO, kind };
  const trimmed = first(raw.trimmed) === '1';

  if (classes.length === 0) {
    return (
      <>
        <Heading />
        <p className="rounded-lg border border-subtle bg-surface px-4 py-6 text-sm text-muted">
          You are not on any classes yet. A class appears here once you own it, or once
          its owner adds you as a co-teacher and you accept the invite in the ilmTrack
          app.
        </p>
      </>
    );
  }

  if (!classId) {
    return (
      <>
        <Heading />
        <p className="rounded-lg border border-subtle bg-surface px-4 py-6 text-sm text-muted">
          Pick a class from the menu in the header to see its reports.
        </p>
      </>
    );
  }

  const report = await loadClassReport(session, classId, kind, range);
  // Missing and not-yours are answered the same way on purpose.
  if (!report) notFound();

  return (
    <>
      <Heading className={report.className} />

      <div className="mb-6 rounded-lg border border-subtle bg-surface p-5">
        <DateRangeForm params={params} fromISO={range.fromISO} toISO={range.toISO} />
        <p className="mt-3 text-xs text-muted">
          Showing {formatRangeLabel(range)}. Defaults to the last month to keep loads
          small — widen it whenever you need more.
        </p>
        {trimmed && (
          <p className="mt-2 rounded-md bg-warn-bg p-2 text-xs text-warn-fg">
            That range was longer than {MAX_RANGE_DAYS} days, so it was trimmed to the
            most recent {MAX_RANGE_DAYS}.
          </p>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1" aria-label="Report">
          {REPORT_KINDS.map((option) => (
            <Link
              key={option}
              href={reportHref(params, { kind: option })}
              aria-current={option === kind ? 'page' : undefined}
              className={
                option === kind
                  ? 'rounded-md bg-surface-muted px-3 py-1.5 text-sm font-medium'
                  : 'rounded-md px-3 py-1.5 text-sm text-muted hover:bg-surface-muted'
              }
            >
              {REPORT_LABELS[option]}
            </Link>
          ))}
        </nav>

        {/* A plain link, so the browser's own download handling applies. */}
        <a
          href={`/api/reports/${classId}/${kind}?from=${range.fromISO}&to=${range.toISO}`}
          className="rounded-md border border-strong px-3 py-1.5 text-sm font-medium hover:bg-surface-muted"
        >
          Download CSV
        </a>
      </div>

      <p className="mb-3 text-sm text-muted">
        {report.rows.length} {report.rows.length === 1 ? 'row' : 'rows'} · {report.studentCount}{' '}
        {report.studentCount === 1 ? 'student' : 'students'} in this class
      </p>

      <ReportTable columns={report.columns} rows={report.rows} totalsRow={report.totalsRow} />
    </>
  );
}

function Heading({ className }: { className?: string }) {
  return (
    <>
      <h1 className="text-xl font-semibold">Reports</h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        {className
          ? `Attendance, homework and per-student totals for ${className}.`
          : 'Attendance, homework and per-student totals for your classes.'}
      </p>
    </>
  );
}
