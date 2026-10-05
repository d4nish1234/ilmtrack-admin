import { requirePermission } from '@/lib/auth/session';
import { can } from '@/lib/auth/roles';
import { loadDirectory } from '@/lib/data/directory';
import { listOrganizations } from '@/lib/data/organizations';
import Directory from './directory';

export const dynamic = 'force-dynamic';

/**
 * Everyone in the system — teachers, parents, admins and students — with
 * filters for role and organization.
 *
 * Super-admin only. A narrower role would need the list scoped to what it may
 * see, and `loadDirectory()` deliberately does not scope: it reads every
 * collection, because the question it answers is "who is in this system".
 */
export default async function UsersPage() {
  const session = await requirePermission('users:read');

  const [directory, orgs] = await Promise.all([loadDirectory(), listOrganizations()]);

  return (
    <>
      <h1 className="text-xl font-semibold">People</h1>
      <p className="mt-1 text-sm text-muted">
        Everyone with an ilmTrack account, plus students. Students are hidden until you
        filter them in.
      </p>
      <Directory
        rows={directory.rows}
        orgs={orgs.map((o) => ({ id: o.id, name: o.name }))}
        mayManageOrgs={can(session.role, 'orgs:manage')}
      />
    </>
  );
}
