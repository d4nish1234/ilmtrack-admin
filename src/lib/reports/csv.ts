/**
 * CSV serialization for report downloads.
 *
 * These files carry names and free-text notes written by teachers and parents,
 * and they are opened in Excel and Google Sheets. Two consequences the
 * serializer has to handle, both of which are easy to get wrong:
 *
 *  1. Formula injection. A cell beginning with = + - @ (or a leading tab or
 *     carriage return) is executed as a formula on open. Every non-numeric
 *     field is therefore prefixed with an apostrophe, which spreadsheets
 *     strip on display. Numeric columns are exempt so that negatives survive.
 *  2. Encoding. Excel assumes the system codepage unless the file opens with
 *     a UTF-8 byte-order mark, and mangles Arabic and accented student names
 *     without one. Every download starts with the BOM.
 */
import type { ReportColumn, ReportRow } from './rows';

/** Prepended to every file so Excel reads it as UTF-8. */
export const UTF8_BOM = '﻿';

const RISKY_PREFIX = /^[=+\-@\t\r]/;

function escapeField(value: string | number | undefined, numeric: boolean): string {
  if (value === undefined || value === null) return '';

  let text = String(value);
  if (!numeric && RISKY_PREFIX.test(text)) text = `'${text}`;

  // Quote only when needed, and double any embedded quotes (RFC 4180).
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(columns: ReportColumn[], rows: ReportRow[]): string {
  const lines = [columns.map((c) => escapeField(c.label, false)).join(',')];

  for (const row of rows) {
    lines.push(columns.map((c) => escapeField(row[c.key], c.numeric === true)).join(','));
  }

  // CRLF per RFC 4180, and a trailing newline so the file ends cleanly.
  return UTF8_BOM + lines.join('\r\n') + '\r\n';
}

/**
 * A filename that sorts sensibly in a downloads folder and survives every
 * filesystem: "Grade 3 Quran" becomes "grade-3-quran-attendance-2026-08-15_2026-09-15.csv".
 */
export function csvFilename(className: string, kind: string, fromISO: string, toISO: string): string {
  const slug =
    className
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'class';
  return `${slug}-${kind}-${fromISO}_${toISO}.csv`;
}
