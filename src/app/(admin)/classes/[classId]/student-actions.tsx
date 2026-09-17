'use client';

import { useEffect, useRef, useState } from 'react';
import type { ClassOption } from '@/lib/data/classes';
import TransferStudentForm from './transfer-student-form';

type Panel = 'menu' | 'transfer';

/**
 * Per-student actions, behind a ⋯ button at the end of the row.
 *
 * The panel is absolutely positioned rather than expanded into the cell: a
 * table row is the wrong place to grow a form, and a client component inside
 * a <td> cannot render the extra <tr> that would otherwise be needed.
 */
export default function StudentActions({
  studentId,
  studentName,
  classes,
}: {
  studentId: string;
  studentName: string;
  classes: ClassOption[];
}) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const container = useRef<HTMLDivElement>(null);

  // Dismiss on Escape or a click elsewhere, as a menu is expected to.
  useEffect(() => {
    if (!panel) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setPanel(null);
    }
    function onPointerDown(event: MouseEvent) {
      if (!container.current?.contains(event.target as Node)) setPanel(null);
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [panel]);

  return (
    <div ref={container} className="relative flex justify-end">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={panel !== null}
        onClick={() => setPanel(panel ? null : 'menu')}
        className="rounded-md px-2 py-1 text-base leading-none text-muted hover:bg-surface-muted"
      >
        <span aria-hidden="true">⋯</span>
        <span className="sr-only">Actions for {studentName}</span>
      </button>

      {panel === 'menu' && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border border-subtle bg-surface py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => setPanel('transfer')}
            className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-muted"
          >
            Transfer to another class…
          </button>
        </div>
      )}

      {panel === 'transfer' && (
        <div className="absolute right-0 top-full z-20 mt-1 w-80 rounded-md border border-subtle bg-surface p-3 text-left shadow-lg">
          <TransferStudentForm
            studentId={studentId}
            studentName={studentName}
            classes={classes}
            onClose={() => setPanel(null)}
          />
        </div>
      )}
    </div>
  );
}
