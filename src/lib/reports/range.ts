/**
 * The report date range lives in the URL, as ?from=YYYY-MM-DD&to=YYYY-MM-DD.
 *
 * That is deliberate. Because the URL is the only place the range is stored,
 * the header class picker can change ?classId while copying every other
 * parameter through untouched — so switching class provably cannot disturb
 * the dates. The reverse holds for the date form, which copies ?classId.
 *
 * Both bounds are inclusive whole days, resolved in the *server's* timezone.
 * The mobile app resolves them on the device, so a report run near midnight
 * from a different timezone can differ by one day's records at the edges.
 *
 * Pure module, no I/O: also imported by client components and unit tests.
 */

/** Default look-back. One month keeps the first load cheap; users can widen it. */
export const DEFAULT_MONTHS_BACK = 1;

/**
 * Widest range a single report may cover. Without this, one hand-edited URL
 * spanning years would undo the point of the default.
 */
export const MAX_RANGE_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReportRange {
  /** Inclusive lower bound, at local midnight. */
  start: Date;
  /** Inclusive upper bound, at the last millisecond of that day. */
  end: Date;
  /** The same two days as they appear in the URL and in <input type="date">. */
  fromISO: string;
  toISO: string;
  /** True when the requested span was wider than MAX_RANGE_DAYS and was cut. */
  clamped: boolean;
}

export function toISODate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Parses YYYY-MM-DD to local midnight. Returns null for anything else. */
export function parseISODate(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  // Rejects 2026-02-31 and friends, which Date would roll over silently.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function subMonths(date: Date, months: number): Date {
  const result = new Date(date.getFullYear(), date.getMonth() - months, date.getDate());
  // Mar 31 minus one month is Feb 31, which rolls into March. Pin it to the
  // last day of the target month instead, as date-fns does.
  if (result.getDate() !== date.getDate()) result.setDate(0);
  return result;
}

/**
 * The range for this request: whatever the URL asked for, or the last month.
 *
 * Malformed values fall back to the default rather than erroring — a report
 * page should still render when someone truncates the query string.
 */
export function parseRange(params: { from?: string; to?: string }, today = new Date()): ReportRange {
  const to = parseISODate(params.to) ?? startOfDay(today);
  const from = parseISODate(params.from) ?? subMonths(to, DEFAULT_MONTHS_BACK);

  // A reversed range is almost always a hand-edited URL; read it as intended.
  const [requestedLower, upper] = from > to ? [to, from] : [from, to];

  const clamped = upper.getTime() - requestedLower.getTime() > MAX_RANGE_DAYS * DAY_MS;
  const lower = clamped
    ? new Date(upper.getTime() - MAX_RANGE_DAYS * DAY_MS)
    : requestedLower;

  return {
    start: startOfDay(lower),
    end: endOfDay(upper),
    fromISO: toISODate(lower),
    toISO: toISODate(upper),
    clamped,
  };
}

/** "Aug 15, 2026 – Sep 15, 2026", for headings and PDF-ish titles. */
export function formatRangeLabel(range: ReportRange): string {
  return `${formatDay(range.start)} – ${formatDay(range.end)}`;
}

export function formatDay(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
