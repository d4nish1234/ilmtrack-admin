'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { OrgMember } from '@/types';
import type { TeacherOption } from '@/lib/data/teachers';

interface ClassOption {
  id: string;
  name: string;
}
interface OrgView {
  id: string;
  name: string;
  members: OrgMember[];
  classes: ClassOption[];
}

/**
 * Organization administration: create one, decide who administers it, and
 * which classes belong to it.
 *
 * Every mutation goes through POST /api/organizations, which re-checks
 * `orgs:manage` server-side. `mayManage` here only decides what renders — the
 * endpoint is the authority, as everywhere else in this console.
 */
export default function OrgAdmin({
  orgs,
  unassigned,
  teachers,
  mayManage,
}: {
  orgs: OrgView[];
  unassigned: ClassOption[];
  teachers: TeacherOption[];
  mayManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');

  async function send(payload: Record<string, unknown>, confirmation?: string) {
    if (confirmation && !window.confirm(confirmation)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? 'That did not work.');
        return;
      }
      setName('');
      router.refresh();
    } catch {
      setError('Request failed. Is the dev server still running?');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 space-y-8">
      {error && <p className="rounded-md bg-danger-bg p-3 text-sm text-danger-fg">{error}</p>}

      {mayManage && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) send({ action: 'create', name });
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <div>
            <label className="mb-1 block text-sm font-medium">New organization</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. ICCM"
              className="min-w-64 rounded-md border border-strong bg-surface px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="rounded-md bg-accent-solid px-3 py-2 text-sm font-medium text-accent-solid-fg disabled:opacity-40"
          >
            Create
          </button>
        </form>
      )}

      {orgs.map((org) => (
        <section key={org.id} className="rounded-md border border-subtle p-4">
          <h2 className="font-medium">{org.name}</h2>
          <p className="font-mono text-xs text-faint">{org.id}</p>

          <h3 className="mt-4 text-sm font-medium">Admins ({org.members.length})</h3>
          {org.members.length === 0 ? (
            <p className="mt-1 text-sm text-muted">Nobody administers this organization yet.</p>
          ) : (
            <ul className="mt-1 divide-y divide-subtle text-sm">
              {org.members.map((m) => (
                <li key={m.userId} className="flex items-center justify-between py-2">
                  <span>
                    {m.email}
                    <span className="ml-2 rounded bg-surface-muted px-1.5 py-0.5 text-xs text-muted">
                      {m.role}
                    </span>
                  </span>
                  {mayManage && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        send(
                          { action: 'removeMember', orgId: org.id, userId: m.userId },
                          `Remove ${m.email} as an admin of ${org.name}? They lose access to its classes immediately.`
                        )
                      }
                      className="rounded-md border border-strong px-2 py-1 text-xs text-danger-fg hover:bg-danger-bg disabled:opacity-40"
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {mayManage && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select
                defaultValue=""
                disabled={busy}
                onChange={(e) => {
                  if (!e.target.value) return;
                  const [userId, role] = e.target.value.split('|');
                  send({ action: 'setMember', orgId: org.id, userId, role });
                  e.target.value = '';
                }}
                className="min-w-72 rounded-md border border-strong bg-surface px-3 py-2 text-sm"
              >
                <option value="">Add an admin&hellip;</option>
                {teachers.map((t) => (
                  <optgroup key={t.uid} label={`${t.name} — ${t.email}`}>
                    <option value={`${t.uid}|admin`}>as admin</option>
                    <option value={`${t.uid}|owner`}>as owner</option>
                  </optgroup>
                ))}
              </select>
              <span className="text-xs text-muted">Only teacher accounts can administer.</span>
            </div>
          )}

          <h3 className="mt-5 text-sm font-medium">Classes ({org.classes.length})</h3>
          {org.classes.length === 0 ? (
            <p className="mt-1 text-sm text-muted">No classes in this organization.</p>
          ) : (
            <ul className="mt-1 divide-y divide-subtle text-sm">
              {org.classes.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2">
                  <span>{c.name}</span>
                  {mayManage && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        send(
                          { action: 'setClassOrg', classId: c.id, orgId: null },
                          `Remove "${c.name}" from ${org.name}? Its admins lose access to it.`
                        )
                      }
                      className="rounded-md border border-strong px-2 py-1 text-xs text-muted hover:bg-surface-muted disabled:opacity-40"
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {mayManage && unassigned.length > 0 && (
            <select
              defaultValue=""
              disabled={busy}
              onChange={(e) => {
                if (!e.target.value) return;
                send({ action: 'setClassOrg', classId: e.target.value, orgId: org.id });
                e.target.value = '';
              }}
              className="mt-3 min-w-72 rounded-md border border-strong bg-surface px-3 py-2 text-sm"
            >
              <option value="">Add a class&hellip;</option>
              {unassigned.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </section>
      ))}
    </div>
  );
}
