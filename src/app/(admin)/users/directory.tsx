'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DirectoryRole, DirectoryRow } from '@/lib/data/directory';
import RowActions from './row-actions';

const ROLE_LABELS: Record<DirectoryRole, string> = {
  'super-admin': 'Super-admins',
  'org-admin': 'Org admins',
  teacher: 'Teachers',
  parent: 'Parents',
  student: 'Students',
};

/**
 * Role and organization filters over the directory.
 *
 * Students default to hidden: there are more of them than everyone else
 * combined, and the usual reason to open this page is to find an account.
 * Filtering happens client-side — the whole list is a few hundred rows, and a
 * round trip per keystroke would be worse.
 */
const DEFAULT_ROLES: DirectoryRole[] = ['super-admin', 'org-admin', 'teacher', 'parent'];

export default function Directory({
  rows,
  orgs,
  mayManageOrgs,
}: {
  rows: DirectoryRow[];
  orgs: Array<{ id: string; name: string }>;
  mayManageOrgs: boolean;
}) {
  const router = useRouter();
  const [roles, setRoles] = useState<DirectoryRole[]>(DEFAULT_ROLES);
  const [orgId, setOrgId] = useState('');
  const [search, setSearch] = useState('');

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!r.roles.some((role) => roles.includes(role))) return false;
      // "No organization" is a meaningful filter, not an absence of one.
      if (orgId === '__none__' && r.orgIds.length > 0) return false;
      if (orgId && orgId !== '__none__' && !r.orgIds.includes(orgId)) return false;
      if (!needle) return true;
      return (
        r.name.toLowerCase().includes(needle) ||
        (r.email || '').toLowerCase().includes(needle) ||
        r.detail.toLowerCase().includes(needle)
      );
    });
  }, [rows, roles, orgId, search]);

  const toggle = (role: DirectoryRole) =>
    setRoles((current) =>
      current.includes(role) ? current.filter((r) => r !== role) : [...current, role]
    );

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(ROLE_LABELS) as DirectoryRole[]).map((role) => {
          const on = roles.includes(role);
          return (
            <button
              key={role}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(role)}
              className={
                on
                  ? 'rounded-full bg-accent-solid px-3 py-1 text-xs font-medium text-accent-solid-fg'
                  : 'rounded-full border border-strong px-3 py-1 text-xs text-muted hover:bg-surface-muted'
              }
            >
              {ROLE_LABELS[role]}
              <span className="ml-1.5 opacity-70">
                {rows.filter((r) => r.roles.includes(role)).length}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={orgId}
          onChange={(e) => setOrgId(e.target.value)}
          className="rounded-md border border-strong bg-surface px-3 py-2 text-sm"
        >
          <option value="">All organizations</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
          <option value="__none__">— no organization —</option>
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email or class"
          className="min-w-64 flex-1 rounded-md border border-strong bg-surface px-3 py-2 text-sm"
        />
      </div>

      <p className="mt-3 text-xs text-muted">
        {visible.length} of {rows.length}
      </p>

      {visible.length === 0 ? (
        <p className="mt-4 text-sm text-muted">Nobody matches those filters.</p>
      ) : (
        <table className="mt-2 w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="pb-2 font-medium">Name</th>
              <th className="pb-2 font-medium">Role</th>
              <th className="pb-2 font-medium">Detail</th>
              {mayManageOrgs && <th className="pb-2 font-medium sr-only">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-subtle">
            {visible.map((row) => (
              <tr key={`${row.kind}-${row.id}`}>
                <td className="py-2">
                  {row.name}
                  {row.email && <div className="text-xs text-muted">{row.email}</div>}
                </td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-1">
                    {row.roles.map((role) => (
                      <span
                        key={role}
                        className="rounded bg-surface-muted px-1.5 py-0.5 text-xs text-muted"
                      >
                        {role}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="py-2 text-muted">{row.detail}</td>
                {mayManageOrgs && (
                  <td className="py-2 text-right">
                    {/* Student rows have no account to act on. */}
                    {row.kind === 'account' && row.roles.includes('teacher') && (
                      <RowActions
                        userId={row.id}
                        email={row.email ?? row.name}
                        orgs={orgs}
                        currentOrgIds={row.orgIds}
                        onDone={() => router.refresh()}
                      />
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
