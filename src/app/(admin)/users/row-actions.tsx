'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Per-person actions, behind a ⋯ button — the same shape as StudentActions and
 * CoTeacherActions, for the same reason: granting someone administrative reach
 * over a whole organization should not sit one stray click away.
 *
 * Offered only for teacher accounts, because only a teacher can administer an
 * organization. The endpoint re-checks that server-side; this just avoids
 * showing an action that would fail.
 */
export default function RowActions({
  userId,
  email,
  orgs,
  currentOrgIds,
  onDone,
}: {
  userId: string;
  email: string;
  orgs: Array<{ id: string; name: string }>;
  currentOrgIds: string[];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);

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

  async function grant(orgId: string, orgName: string, role: 'admin' | 'owner') {
    setOpen(false);
    if (
      !window.confirm(
        `Make ${email} an ${role} of ${orgName}?\n\n` +
          'They will be able to see and report on every class in that organization, ' +
          'and move students between them.'
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setMember', orgId, userId, role }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? 'Could not grant that.');
        return;
      }
      onDone();
    } catch {
      setError('Request failed. Is the dev server still running?');
    } finally {
      setBusy(false);
    }
  }

  if (orgs.length === 0) return null;

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
        <span className="sr-only">Actions for {email}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-64 rounded-md border border-subtle bg-surface py-1 text-left shadow-lg"
        >
          {orgs.map((org) => {
            const already = currentOrgIds.includes(org.id);
            return (
              <div key={org.id}>
                <p className="px-3 pt-2 text-xs font-medium text-muted">
                  {org.name}
                  {already && <span className="ml-1 text-faint">· already a member</span>}
                </p>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => grant(org.id, org.name, 'admin')}
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-surface-muted"
                >
                  Make admin
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => grant(org.id, org.name, 'owner')}
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-surface-muted"
                >
                  Make owner
                </button>
              </div>
            );
          })}
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
