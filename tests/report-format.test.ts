/**
 * Pure report logic: date-range parsing, CSV serialization, summary
 * arithmetic. No emulator and no Firebase app — these run anywhere.
 */
import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import {
  MAX_RANGE_DAYS,
  parseISODate,
  parseRange,
  toISODate,
} from '@/lib/reports/range';
import { toCsv, UTF8_BOM, csvFilename } from '@/lib/reports/csv';
import {
  ATTENDANCE_COLUMNS,
  SUMMARY_COLUMNS,
  buildAttendanceRows,
  computeStudentSummaries,
  summaryTotals,
} from '@/lib/reports/rows';
import type { Attendance, Homework, Student } from '@/types';

const TODAY = new Date(2026, 8, 15); // 15 Sep 2026, local

describe('parseRange', () => {
  it('defaults to the month before today', () => {
    const range = parseRange({}, TODAY);
    expect(range.fromISO).toBe('2026-08-15');
    expect(range.toISO).toBe('2026-09-15');
  });

  it('covers whole days at both ends', () => {
    const { start, end } = parseRange({ from: '2026-09-01', to: '2026-09-01' }, TODAY);
    expect(start.getHours()).toBe(0);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    // A record stamped any time that day falls inside.
    expect(new Date(2026, 8, 1, 14, 30).getTime()).toBeGreaterThan(start.getTime());
    expect(new Date(2026, 8, 1, 14, 30).getTime()).toBeLessThan(end.getTime());
  });

  it('falls back to the default rather than erroring on junk', () => {
    expect(parseRange({ from: 'yesterday', to: '' }, TODAY).fromISO).toBe('2026-08-15');
    expect(parseRange({ from: '2026-02-31' }, TODAY).fromISO).toBe('2026-08-15');
  });

  it('reads a reversed range as intended', () => {
    const range = parseRange({ from: '2026-09-10', to: '2026-09-01' }, TODAY);
    expect(range.fromISO).toBe('2026-09-01');
    expect(range.toISO).toBe('2026-09-10');
  });

  it('trims a range wider than the cap, and says so', () => {
    const range = parseRange({ from: '2019-01-01', to: '2026-09-15' }, TODAY);
    expect(range.clamped).toBe(true);
    const days = (range.end.getTime() - range.start.getTime()) / 86_400_000;
    expect(days).toBeLessThanOrEqual(MAX_RANGE_DAYS + 1);
  });

  it('is idempotent on its own output, so the page cannot redirect in a loop', () => {
    const once = parseRange({ from: '2019-01-01', to: '2026-09-15' }, TODAY);
    const twice = parseRange({ from: once.fromISO, to: once.toISO }, TODAY);
    expect(twice.fromISO).toBe(once.fromISO);
    expect(twice.toISO).toBe(once.toISO);
    expect(twice.clamped).toBe(false);
  });

  it('handles month-end look-back without rolling over', () => {
    // 31 Mar minus a month is not 31 Feb.
    expect(parseRange({ to: '2026-03-31' }, TODAY).fromISO).toBe('2026-02-28');
  });

  it('round-trips through toISODate', () => {
    expect(toISODate(parseISODate('2026-12-01')!)).toBe('2026-12-01');
  });
});

describe('toCsv', () => {
  const columns = [
    { key: 'student', label: 'Student' },
    { key: 'notes', label: 'Notes' },
    { key: 'count', label: 'Count', numeric: true },
  ];

  it('starts with a BOM so Excel reads it as UTF-8', () => {
    expect(toCsv(columns, [])).toMatch(/^﻿/);
    expect(toCsv(columns, []).slice(UTF8_BOM.length)).toBe('Student,Notes,Count\r\n');
  });

  it('quotes commas, quotes and newlines per RFC 4180', () => {
    const csv = toCsv(columns, [{ student: 'Ali, Zayd', notes: 'said "great"', count: 2 }]);
    expect(csv).toContain('"Ali, Zayd"');
    expect(csv).toContain('"said ""great"""');
  });

  it('defuses spreadsheet formulas in text a parent or teacher typed', () => {
    const csv = toCsv(columns, [
      { student: '=1+1', notes: '@SUM(A1:A9)', count: 3 },
      { student: '+44 7700 900000', notes: '-oops', count: 4 },
    ]);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'@SUM(A1:A9)");
    expect(csv).toContain("'+44 7700 900000");
    expect(csv).toContain("'-oops");
  });

  it('leaves numeric columns alone, so negatives survive', () => {
    const csv = toCsv(columns, [{ student: 'Ali', notes: '', count: -3 }]);
    expect(csv).toContain('Ali,,-3');
  });

  it('names the file after the class and range', () => {
    expect(csvFilename('Grade 3 Qur’an', 'attendance', '2026-08-15', '2026-09-15')).toBe(
      'grade-3-qur-an-attendance-2026-08-15_2026-09-15.csv'
    );
    expect(csvFilename('', 'homework', '2026-01-01', '2026-01-02')).toBe(
      'class-homework-2026-01-01_2026-01-02.csv'
    );
  });
});

// ── Row builders and summary maths ─────────────────────────────────────────

const stamp = (y: number, m: number, d: number) => Timestamp.fromDate(new Date(y, m - 1, d));

function student(id: string, firstName: string, lastName: string): Student {
  return {
    id,
    firstName,
    lastName,
    classId: 'c1',
    teacherId: 'owner',
    parents: [],
    createdAt: stamp(2026, 1, 1),
    updatedAt: stamp(2026, 1, 1),
  };
}

function attendance(studentId: string, status: Attendance['status'], day: number): Attendance {
  return {
    id: `a-${studentId}-${day}`,
    studentId,
    classId: 'c1',
    teacherId: 'owner',
    date: stamp(2026, 9, day),
    status,
    createdAt: stamp(2026, 9, day),
    updatedAt: stamp(2026, 9, day),
  };
}

function homework(
  studentId: string,
  status: Homework['status'],
  evaluation: Homework['evaluation'],
  day: number
): Homework {
  return {
    id: `h-${studentId}-${day}`,
    studentId,
    classId: 'c1',
    teacherId: 'owner',
    title: 'Surah Al-Fatiha',
    status,
    evaluation,
    createdAt: stamp(2026, 9, day),
    updatedAt: stamp(2026, 9, day),
  };
}

describe('buildAttendanceRows', () => {
  it('sorts by date and resolves student names', () => {
    const rows = buildAttendanceRows(
      [attendance('s1', 'absent', 9), attendance('s1', 'present', 2)],
      new Map([['s1', 'Ali Khan']])
    );
    expect(rows.map((r) => r.date)).toEqual(['2026-09-02', '2026-09-09']);
    expect(rows[0].student).toBe('Ali Khan');
  });

  it('labels a record whose student has since been removed', () => {
    const rows = buildAttendanceRows([attendance('gone', 'present', 3)], new Map());
    expect(rows[0].student).toBe('Unknown');
  });
});

describe('computeStudentSummaries', () => {
  const students = [student('s2', 'Zayd', 'Omar'), student('s1', 'Ali', 'Khan')];
  const records = {
    attendance: [
      attendance('s1', 'present', 1),
      attendance('s1', 'present', 2),
      attendance('s1', 'absent', 3),
      attendance('s2', 'late', 1),
    ],
    homework: [
      homework('s1', 'completed', 5, 1),
      homework('s1', 'late', 3, 2),
      homework('s1', 'assigned', undefined, 3),
      homework('s2', 'incomplete', undefined, 1),
    ],
  };

  it('sorts by student name', () => {
    const summaries = computeStudentSummaries(students, records.attendance, records.homework);
    expect(summaries.map((s) => s.studentName)).toEqual(['Ali Khan', 'Zayd Omar']);
  });

  it('averages stars over evaluated homework only', () => {
    const [ali] = computeStudentSummaries(students, records.attendance, records.homework);
    expect(ali.totalStars).toBe(8);
    // 8 over the two evaluated items, not over all three.
    expect(ali.averageStars).toBe(4);
  });

  it('counts each status separately and ignores late/excused attendance', () => {
    const [ali, zayd] = computeStudentSummaries(students, records.attendance, records.homework);
    expect(ali.totalPresent).toBe(2);
    expect(ali.totalAbsent).toBe(1);
    expect(ali.totalHomework).toBe(3);
    expect(ali.completedHomework).toBe(1);
    expect(ali.lateHomework).toBe(1);
    expect(ali.assignedHomework).toBe(1);
    // 'late' is neither present nor absent, matching the mobile app.
    expect(zayd.totalPresent).toBe(0);
    expect(zayd.totalAbsent).toBe(0);
  });

  it('gives a student with no records an all-zero row rather than omitting them', () => {
    const summaries = computeStudentSummaries([student('s9', 'New', 'Pupil')], [], []);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].averageStars).toBe(0);
    expect(summaries[0].totalHomework).toBe(0);
  });

  it('totals the columns and averages the per-student averages', () => {
    const summaries = computeStudentSummaries(students, records.attendance, records.homework);
    const totals = summaryTotals(summaries);
    expect(totals.totalStars).toBe(8);
    expect(totals.totalPresent).toBe(2);
    expect(totals.totalHomework).toBe(4);
    // Ali 4, Zayd 0 -> 2
    expect(totals.averageStars).toBe(2);
  });

  it('has a column for every field, so the CSV and the table cannot drift', () => {
    const summaries = computeStudentSummaries(students, records.attendance, records.homework);
    for (const column of SUMMARY_COLUMNS) {
      expect(summaries[0]).toHaveProperty(column.key);
    }
    for (const column of ATTENDANCE_COLUMNS) {
      expect(buildAttendanceRows(records.attendance, new Map())[0]).toHaveProperty(column.key);
    }
  });
});
