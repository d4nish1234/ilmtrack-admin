'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { reportHref, type ReportParams } from '@/lib/reports/query';

/**
 * The report date range.
 *
 * Defaults to the last month — set by parseRange(), not here — so the first
 * load of a class stays cheap. Widening it is one edit away.
 *
 * The inputs are held locally so typing a date does not navigate on every
 * keystroke; Apply is what writes the URL, and it writes only `from` and `to`.
 * The class in `params` is copied through, so changing dates never changes
 * class, just as changing class never changes dates.
 */
export default function DateRangeForm({
  params,
  fromISO,
  toISO,
}: {
  params: ReportParams;
  fromISO: string;
  toISO: string;
}) {
  const router = useRouter();
  const [from, setFrom] = useState(fromISO);
  const [to, setTo] = useState(toISO);

  const dirty = from !== fromISO || to !== toISO;

  function apply(event: React.FormEvent) {
    event.preventDefault();
    router.push(reportHref(params, { from, to }));
  }

  return (
    <form onSubmit={apply} className="flex flex-wrap items-end gap-3">
      <Field label="From" value={from} max={to} onChange={setFrom} />
      <Field label="To" value={to} min={from} onChange={setTo} />
      <button
        type="submit"
        disabled={!dirty}
        className="rounded-md bg-accent-solid px-3 py-2 text-sm font-medium text-accent-solid-fg disabled:opacity-40"
      >
        Apply
      </button>
    </form>
  );
}

function Field({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-xs text-muted">
      <span className="mb-1 block uppercase tracking-wide">{label}</span>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-strong bg-surface px-3 py-2 text-sm text-body"
      />
    </label>
  );
}
