'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { TeacherOption } from '@/lib/data/teachers';

export default function LinkTeacherForm({
  classId,
  teachers,
}: {
  classId: string;
  teachers: TeacherOption[];
}) {
  const router = useRouter();
  const [teacherUserId, setTeacherUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!teacherUserId) return;

    const teacher = teachers.find((t) => t.uid === teacherUserId);
    if (
      !window.confirm(
        `Add ${teacher?.email} as a co-teacher? They will get access to this class's ` +
          'students, homework, and attendance, and will be emailed about it.'
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    setDone(null);

    try {
      const response = await fetch(`/api/classes/${classId}/co-teachers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacherUserId }),
      });
      const result = await response.json();

      if (!response.ok) {
        setError(result.error ?? 'Could not link that teacher.');
        return;
      }

      const counts = Object.entries(result.backfilled as Record<string, number>)
        .map(([name, n]) => `${n} ${name}`)
        .join(', ');
      setDone(`Linked ${result.teacherEmail}. Updated ${counts}.`);
      setTeacherUserId('');
      router.refresh();
    } catch {
      setError('Request failed. Is the dev server still running?');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label className="mb-2 block text-sm font-medium">Link a teacher</label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={teacherUserId}
          onChange={(e) => setTeacherUserId(e.target.value)}
          className="min-w-64 rounded-md border border-strong bg-surface px-3 py-2 text-sm"
        >
          <option value="">Select a teacher…</option>
          {teachers.map((t) => (
            <option key={t.uid} value={t.uid}>
              {t.name} — {t.email}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={busy || !teacherUserId}
          className="rounded-md bg-accent-solid px-3 py-2 text-sm font-medium text-accent-solid-fg disabled:opacity-40"
        >
          {busy ? 'Linking…' : 'Link as co-teacher'}
        </button>
      </div>
      <p className="mt-2 text-xs text-muted">
        Only registered teachers appear here. To invite someone without an ilmTrack account,
        use the mobile app.
      </p>
      {error && <p className="mt-2 text-sm text-danger-fg">{error}</p>}
      {done && <p className="mt-2 text-sm text-ok-fg">{done}</p>}
    </form>
  );
}
