'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { ClassRow } from '@/lib/data/classes';

export default function ClassTable({ classes }: { classes: ClassRow[] }) {
  const [filter, setFilter] = useState('');

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return classes;
    return classes.filter((c) =>
      [c.name, c.ownerName, c.ownerEmail].some((field) => field.toLowerCase().includes(q))
    );
  }, [classes, filter]);

  return (
    <>
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by class name, teacher name, or email…"
        className="mb-4 w-full max-w-md rounded-md border border-strong bg-surface px-3 py-2 text-sm"
      />

      <div className="overflow-x-auto rounded-lg border border-subtle bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Class</th>
              <th className="px-4 py-2 font-medium">Owner</th>
              <th className="px-4 py-2 font-medium text-right">Students</th>
              <th className="px-4 py-2 font-medium text-right">Co-teachers</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-subtle">
            {visible.map((c) => (
              <tr key={c.id} className="hover:bg-surface-muted">
                <td className="px-4 py-2">
                  <Link href={`/classes/${c.id}`} className="text-accent hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  {c.ownerName}
                  <span className="block text-xs text-muted">{c.ownerEmail}</span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{c.studentCount}</td>
                <td className="px-4 py-2 text-right tabular-nums">{c.coTeacherCount}</td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted">
                  No classes match that filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
