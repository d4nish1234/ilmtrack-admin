'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * Per-co-teacher actions, behind a ⋯ button at the end of the row — the same
 * shape as StudentActions, and for the same reason: unlinking revokes access
 * to a whole class, so it should not sit one stray click away.
 *
 * Keyed on email rather than uid on purpose. The entries this exists to repair
 * are precisely the ones whose uid points at a deleted account, so the uid is
 * the one field that cannot be trusted. See src/lib/actions/unlink-teacher.ts.
 */
export default function CoTeacherActions({
  classId,
  teacherEmail,
  orphanedUid,
}: {
  classId: string;
  teacherEmail: string;
  /** Switches the confirmation to the repair wording. */
  orphanedUid?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);

  // Dismiss on Escape or a click elsewhere, as a menu is expected to.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    function onPointerDown(event: MouseEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  async function handleUnlink() {
    setOpen(false);

    const warning = orphanedUid
      ? `Unlink ${teacherEmail}?\n\nThis entry points at a deleted account, so they ` +
        'currently see nothing. Unlinking clears it; link them again afterwards to ' +
        'restore access under their current account.'
      : `Unlink ${teacherEmail}?\n\nThey will immediately lose access to this class's ` +
        'students, homework, and attendance. Link them again to undo it.';

    if (!window.confirm(warning)) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/classes/${classId}/co-teachers`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacherEmail }),
      });
      const result = await response.json();

      if (!response.ok) {
        setError(result.error ?? 'Could not unlink that teacher.');
        return;
      }

      router.refresh();
    } catch {
      setError('Request failed. Is the dev server still running?');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={container} className="relative flex justify-end">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen(!open)}
        className="rounded-md px-2 py-1 text-base leading-none text-muted hover:bg-surface-muted disabled:opacity-40"
      >
        <span aria-hidden="true">⋯</span>
        <span className="sr-only">Actions for {teacherEmail}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border border-subtle bg-surface py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={handleUnlink}
            className="block w-full px-3 py-2 text-left text-sm text-danger-fg hover:bg-surface-muted"
          >
            Unlink from this class…
          </button>
        </div>
      )}

      {error && (
        <p className="absolute right-0 top-full z-20 mt-1 w-64 rounded-md border border-subtle bg-surface p-2 text-left text-xs text-danger-fg shadow-lg">
          {error}
        </p>
      )}
    </div>
  );
}
