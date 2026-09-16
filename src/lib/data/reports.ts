import 'server-only';

import { Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import type { Session } from '@/lib/auth/session';
import type { Attendance, Homework, Student } from '@/types';
import { getVisibleClass } from './classes';
import type { ReportRange } from '@/lib/reports/range';
import {
  ATTENDANCE_COLUMNS,
  HOMEWORK_COLUMNS,
  SUMMARY_COLUMNS,
  buildAttendanceRows,
  buildHomeworkRows,
  computeStudentSummaries,
  studentName,
  summaryTotals,
  type ReportColumn,
  type ReportRow,
} from '@/lib/reports/rows';

/**
 * Report reads, scoped by getVisibleClass() — the same rule the class list and
 * detail page use. Nothing here trusts the classId in the URL.
 *
 * ── On date filtering and Firestore indexes ───────────────────────────────
 *
 * A Firestore query may combine any number of equality filters without a
 * composite index (they are served by merge join), but adding a *range*
 * filter needs one. ilmTrack's firestore.indexes.json has no index that fits
 * `classId == X` plus a range, so by default we fetch the class's records
 * with an equality-only query and narrow the range in memory — which is what
 * the mobile app's own report screen does.
 *
 * That is correct but chatty: the one-month default then saves transfer and
 * rendering, not Firestore reads. Setting REPORTS_DATE_INDEXES=true switches
 * to server-side range filtering, which needs these two indexes created first
 * (Firebase Console → Firestore → Indexes; this is project configuration, so
 * it does not mean editing anything in ../ilmTrack):
 *
 *   attendance:  classId ASC, date ASC
 *   homework:    classId ASC, createdAt ASC
 *
 * Results are identical either way; only the read volume differs.
 *
 * Note the asymmetry in which field each collection is filtered on —
 * attendance by `date`, homework by `createdAt`. That is inherited from the
 * mobile app, and kept so both surfaces report the same totals.
 */

function dateIndexesEnabled(): boolean {
  return process.env.REPORTS_DATE_INDEXES === 'true';
}

export type ReportKind = 'attendance' | 'homework' | 'summary';

export const REPORT_KINDS: ReportKind[] = ['attendance', 'homework', 'summary'];

export function isReportKind(value: unknown): value is ReportKind {
  return typeof value === 'string' && (REPORT_KINDS as string[]).includes(value);
}

export const REPORT_LABELS: Record<ReportKind, string> = {
  attendance: 'Attendance',
  homework: 'Homework',
  summary: 'Class summary',
};

async function fetchStudents(classId: string): Promise<Student[]> {
  const snap = await getAdminDb().collection('students').where('classId', '==', classId).get();
  return snap.docs.map((d) => ({ ...(d.data() as Student), id: d.id }));
}

async function fetchAttendance(classId: string, range: ReportRange): Promise<Attendance[]> {
  let query = getAdminDb().collection('attendance').where('classId', '==', classId);

  if (dateIndexesEnabled()) {
    query = query
      .where('date', '>=', Timestamp.fromDate(range.start))
      .where('date', '<=', Timestamp.fromDate(range.end));
  }

  const snap = await query.get();
  const records = snap.docs.map((d) => ({ ...(d.data() as Attendance), id: d.id }));

  if (dateIndexesEnabled()) return records;
  return records.filter((a) => withinRange(a.date, range));
}

async function fetchHomework(classId: string, range: ReportRange): Promise<Homework[]> {
  let query = getAdminDb().collection('homework').where('classId', '==', classId);

  if (dateIndexesEnabled()) {
    query = query
      .where('createdAt', '>=', Timestamp.fromDate(range.start))
      .where('createdAt', '<=', Timestamp.fromDate(range.end));
  }

  const snap = await query.get();
  const records = snap.docs.map((d) => ({ ...(d.data() as Homework), id: d.id }));

  if (dateIndexesEnabled()) return records;
  return records.filter((h) => withinRange(h.createdAt, range));
}

function withinRange(stamp: Timestamp | undefined, range: ReportRange): boolean {
  if (!stamp) return false;
  const ms = stamp.toDate().getTime();
  return ms >= range.start.getTime() && ms <= range.end.getTime();
}

export interface ClassReport {
  classId: string;
  className: string;
  kind: ReportKind;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Appended to the table and the CSV, for the summary only. */
  totalsRow?: ReportRow;
  studentCount: number;
}

/**
 * Build one report. Returns null when the class does not exist or this caller
 * may not see it — callers answer both with notFound().
 */
export async function loadClassReport(
  session: Session,
  classId: string,
  kind: ReportKind,
  range: ReportRange
): Promise<ClassReport | null> {
  const cls = await getVisibleClass(session, classId);
  if (!cls) return null;

  const students = await fetchStudents(classId);
  const names = new Map(students.map((s) => [s.id, studentName(s)]));
  const base = { classId, className: cls.name, kind, studentCount: students.length };

  if (kind === 'attendance') {
    const attendance = await fetchAttendance(classId, range);
    return {
      ...base,
      columns: ATTENDANCE_COLUMNS,
      rows: buildAttendanceRows(attendance, names),
    };
  }

  if (kind === 'homework') {
    const homework = await fetchHomework(classId, range);
    return { ...base, columns: HOMEWORK_COLUMNS, rows: buildHomeworkRows(homework, names) };
  }

  const [attendance, homework] = await Promise.all([
    fetchAttendance(classId, range),
    fetchHomework(classId, range),
  ]);
  const summaries = computeStudentSummaries(students, attendance, homework);

  return {
    ...base,
    columns: SUMMARY_COLUMNS,
    rows: summaries,
    totalsRow: summaryTotals(summaries),
  };
}
