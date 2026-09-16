/**
 * Report row shapes and the summary arithmetic.
 *
 * Hand-ported from ../ilmTrack/src/utils/reportUtils.ts, for the same reason
 * src/types/ is hand-copied: the app builds on the Firebase *client* SDK and
 * this one on firebase-admin, and their Timestamp classes are different
 * types. The arithmetic below is kept identical on purpose — a teacher
 * comparing this console against the app's own report should see the same
 * numbers. Change it here only when it changes there.
 *
 * The HTML/PDF generators in that file are deliberately not ported: this
 * console renders an on-screen table and downloads CSV instead.
 */
import type { Attendance, Homework, HomeworkEvaluation, Student } from '@/types';
import { EVALUATION_LABELS } from '@/types';

export interface ReportColumn {
  key: string;
  label: string;
  /** Right-aligned and tabular in the table; unquoted in CSV. */
  numeric?: boolean;
}

export type ReportRow = Record<string, string | number>;

/** Anything with a toDate(), which is every Timestamp field we read. */
function toDate(value: { toDate(): Date } | undefined | null): Date | null {
  return value ? value.toDate() : null;
}

function isoDay(value: { toDate(): Date } | undefined | null): string {
  const date = toDate(value);
  if (!date) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function studentName(student: Pick<Student, 'firstName' | 'lastName'>): string {
  return `${student.firstName ?? ''} ${student.lastName ?? ''}`.trim() || '(no name)';
}

// ── Attendance ─────────────────────────────────────────────────────────────

export const ATTENDANCE_COLUMNS: ReportColumn[] = [
  { key: 'date', label: 'Date' },
  { key: 'student', label: 'Student' },
  { key: 'status', label: 'Status' },
  { key: 'notes', label: 'Notes' },
];

export function buildAttendanceRows(
  attendance: Attendance[],
  names: Map<string, string>
): ReportRow[] {
  return [...attendance]
    .sort((a, b) => (toDate(a.date)?.getTime() ?? 0) - (toDate(b.date)?.getTime() ?? 0))
    .map((a) => ({
      date: isoDay(a.date),
      student: names.get(a.studentId) ?? 'Unknown',
      status: a.status,
      notes: a.notes || '',
    }));
}

// ── Homework ───────────────────────────────────────────────────────────────

export const HOMEWORK_COLUMNS: ReportColumn[] = [
  { key: 'date', label: 'Date' },
  { key: 'student', label: 'Student' },
  { key: 'title', label: 'Title' },
  { key: 'status', label: 'Status' },
  { key: 'evaluation', label: 'Evaluation' },
  { key: 'description', label: 'Description' },
  { key: 'notes', label: 'Notes' },
];

export function buildHomeworkRows(
  homework: Homework[],
  names: Map<string, string>
): ReportRow[] {
  return [...homework]
    .sort((a, b) => (toDate(a.createdAt)?.getTime() ?? 0) - (toDate(b.createdAt)?.getTime() ?? 0))
    .map((h) => ({
      date: isoDay(h.createdAt),
      student: names.get(h.studentId) ?? 'Unknown',
      title: h.title,
      status: h.status,
      evaluation: h.evaluation ? EVALUATION_LABELS[h.evaluation as HomeworkEvaluation] : '',
      description: h.description || '',
      notes: h.notes || '',
    }));
}

// ── Per-student summary ────────────────────────────────────────────────────

export const SUMMARY_COLUMNS: ReportColumn[] = [
  { key: 'studentName', label: 'Student' },
  { key: 'totalStars', label: 'Total Stars', numeric: true },
  { key: 'averageStars', label: 'Avg Stars', numeric: true },
  { key: 'totalPresent', label: 'Present', numeric: true },
  { key: 'totalAbsent', label: 'Absent', numeric: true },
  { key: 'totalHomework', label: 'Total HW', numeric: true },
  { key: 'completedHomework', label: 'Completed', numeric: true },
  { key: 'lateHomework', label: 'Late', numeric: true },
  { key: 'incompleteHomework', label: 'Incomplete', numeric: true },
  { key: 'assignedHomework', label: 'Assigned', numeric: true },
];

export interface StudentSummary extends ReportRow {
  studentName: string;
  totalStars: number;
  averageStars: number;
  totalPresent: number;
  totalAbsent: number;
  totalHomework: number;
  completedHomework: number;
  lateHomework: number;
  incompleteHomework: number;
  assignedHomework: number;
}

function groupBy<T extends { studentId: string }>(items: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const list = grouped.get(item.studentId);
    if (list) list.push(item);
    else grouped.set(item.studentId, [item]);
  }
  return grouped;
}

export function computeStudentSummaries(
  students: Student[],
  attendance: Attendance[],
  homework: Homework[]
): StudentSummary[] {
  const attendanceByStudent = groupBy(attendance);
  const homeworkByStudent = groupBy(homework);

  return students
    .map((student) => {
      const studentAttendance = attendanceByStudent.get(student.id) || [];
      const studentHomework = homeworkByStudent.get(student.id) || [];

      const evaluated = studentHomework.filter((h) => h.evaluation);
      const totalStars = evaluated.reduce((sum, h) => sum + (h.evaluation || 0), 0);

      return {
        studentName: studentName(student),
        totalStars,
        averageStars:
          evaluated.length > 0 ? Math.round((totalStars / evaluated.length) * 10) / 10 : 0,
        totalPresent: studentAttendance.filter((a) => a.status === 'present').length,
        totalAbsent: studentAttendance.filter((a) => a.status === 'absent').length,
        totalHomework: studentHomework.length,
        completedHomework: studentHomework.filter((h) => h.status === 'completed').length,
        lateHomework: studentHomework.filter((h) => h.status === 'late').length,
        incompleteHomework: studentHomework.filter((h) => h.status === 'incomplete').length,
        assignedHomework: studentHomework.filter((h) => h.status === 'assigned').length,
      };
    })
    .sort((a, b) => a.studentName.localeCompare(b.studentName));
}

/** The "Totals / Avg" footer row the app's PDF ends with. */
export function summaryTotals(summaries: StudentSummary[]): StudentSummary {
  const sum = (pick: (s: StudentSummary) => number) =>
    summaries.reduce((total, s) => total + pick(s), 0);

  return {
    studentName: 'Totals / Avg',
    totalStars: sum((s) => s.totalStars),
    averageStars:
      summaries.length > 0
        ? Math.round((sum((s) => s.averageStars) / summaries.length) * 10) / 10
        : 0,
    totalPresent: sum((s) => s.totalPresent),
    totalAbsent: sum((s) => s.totalAbsent),
    totalHomework: sum((s) => s.totalHomework),
    completedHomework: sum((s) => s.completedHomework),
    lateHomework: sum((s) => s.lateHomework),
    incompleteHomework: sum((s) => s.incompleteHomework),
    assignedHomework: sum((s) => s.assignedHomework),
  };
}
