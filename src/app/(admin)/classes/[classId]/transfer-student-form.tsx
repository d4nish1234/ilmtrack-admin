'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ClassOption } from '@/lib/data/classes';

interface Finding {
  kind: string;
  message: string;
}

/**
 * Move one student to another class. Rendered inside the row's ⋯ menu, which
 * owns opening and closing — hence onClose rather than local open state.
 *
 * Warnings from the endpoint are shown in full and need a second, explicit
 * click; blockers cannot be clicked past at all — the button is simply not
 * offered, because the server would refuse anyway.
 */
export default function TransferStudentForm({
  studentId,
  studentName,
  classes,
  onClose,
}: {
  studentId: string;
  studentName: string;
  classes: ClassOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [toClassId, setToClassId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<Finding[]>([]);
  const [warnings, setWarnings] = useState<Finding[]>([]);

  async function transfer(acknowledge: boolean) {
    setBusy(true);
    setError(null);
    if (!acknowledge) {
      setBlockers([]);
      setWarnings([]);
    }

    try {
      const response = await fetch(`/api/students/${studentId}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toClassId, acknowledge }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? 'Transfer failed.');
        setBlockers(data.blockers ?? []);
        setWarnings(data.warnings ?? []);
        return;
      }

      onClose();
      router.refresh();
    } catch {
      setError('Transfer failed. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="mb-2 text-xs text-muted">
        Move <strong>{studentName}</strong> and their whole homework and attendance
        history to another class. The class they leave will no longer show them in
        past reports.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={toClassId}
          onChange={(event) => {
            setToClassId(event.target.value);
            setError(null);
            setBlockers([]);
            setWarnings([]);
          }}
          className="rounded-md border border-strong bg-surface px-2 py-1 text-sm"
        >
          <option value="">Move to…</option>
          {classes.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          disabled={!toClassId || busy}
          onClick={() => transfer(false)}
          className="rounded-md bg-accent-solid px-3 py-1 text-sm font-medium text-accent-solid-fg disabled:opacity-40"
        >
          {busy ? 'Transferring…' : 'Transfer'}
        </button>

        <button
          type="button"
          onClick={onClose}
          className="text-xs text-muted hover:underline"
        >
          Cancel
        </button>
      </div>

      {blockers.map((finding) => (
        <p key={finding.message} className="mt-2 rounded-md bg-danger-bg p-2 text-xs text-danger-fg">
          {finding.message}
        </p>
      ))}

      {warnings.map((finding) => (
        <p key={finding.message} className="mt-2 rounded-md bg-warn-bg p-2 text-xs text-warn-fg">
          {finding.message}
        </p>
      ))}

      {error && blockers.length === 0 && warnings.length === 0 && (
        <p className="mt-2 text-xs text-danger-fg">{error}</p>
      )}

      {warnings.length > 0 && blockers.length === 0 && (
        <button
          type="button"
          disabled={busy}
          onClick={() => transfer(true)}
          className="mt-2 rounded-md border border-strong px-3 py-1 text-sm font-medium disabled:opacity-40"
        >
          Transfer anyway
        </button>
      )}
    </div>
  );
}
