'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { reportHref } from '@/lib/reports/query';
import type { ClassOption } from '@/lib/data/classes';

/**
 * The header class picker, available on every page.
 *
 * It reads the live query string and writes back only `classId`, copying
 * every other parameter through untouched — which is precisely why switching
 * class leaves the report's date range alone. There is no local state here to
 * fall out of sync: the URL is the only place the selection lives.
 */
function Switcher({ classes }: { classes: ClassOption[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const current = Object.fromEntries(searchParams.entries());
  const selected = current.classId ?? '';

  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">Class</span>
      <select
        value={selected}
        onChange={(event) => router.push(reportHref(current, { classId: event.target.value }))}
        className="max-w-[16rem] rounded-md border border-strong bg-surface px-2 py-1 text-sm"
      >
        {!selected && <option value="">Select a class…</option>}
        {classes.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function ClassSwitcher({ classes }: { classes: ClassOption[] }) {
  // useSearchParams() opts its subtree into dynamic rendering; the boundary
  // keeps that from spreading to the rest of the shell.
  return (
    <Suspense fallback={null}>
      <Switcher classes={classes} />
    </Suspense>
  );
}
