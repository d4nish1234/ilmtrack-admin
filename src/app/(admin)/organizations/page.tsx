import { requirePermission } from '@/lib/auth/session';
import { can } from '@/lib/auth/roles';
import { listOrganizations, orgsForUser } from '@/lib/data/organizations';
import { visibleClassDocs } from '@/lib/data/classes';
import { listTeachers } from '@/lib/data/teachers';
import OrgAdmin from './org-admin';

export const dynamic = 'force-dynamic';

/**
 * Organizations group classes so administrative rights can be granted over
 * several at once.
 *
 * An org admin sees only the organizations they belong to, and only to read:
 * `orgs:manage` is deliberately not in their permission list, so they cannot
 * add themselves to another organization, promote anyone, or move a class in
 * or out. A super-admin sees and edits all of them.
 */
export default async function OrganizationsPage() {
  const session = await requirePermission('orgs:read');
  const mayManage = can(session.role, 'orgs:manage');

  // An org admin's query is scoped, not filtered after the fact: it asks only
  // for organizations they belong to. Filtering a full list would render the
  // same thing, but it would read every organization to do it.
  const [visible, classes, teachers] = await Promise.all([
    mayManage ? listOrganizations() : orgsForUser(session.uid),
    visibleClassDocs(session),
    mayManage ? listTeachers() : Promise.resolve([]),
  ]);

  return (
    <>
      <h1 className="text-xl font-semibold">Organizations</h1>
      <p className="mt-1 text-sm text-muted">
        A class in an organization can be administered by that organization&rsquo;s admins —
        including moving a student between any two of its classes.
      </p>

      {visible.length === 0 && !mayManage && (
        <p className="mt-6 text-sm text-muted">You do not administer an organization.</p>
      )}

      <OrgAdmin
        orgs={visible.map((o) => ({
          id: o.id,
          name: o.name,
          members: o.members || [],
          classes: classes
            .filter((c) => c.orgId === o.id)
            .map((c) => ({ id: c.id, name: c.name })),
        }))}
        unassigned={classes
          .filter((c) => !c.orgId)
          .map((c) => ({ id: c.id, name: c.name }))}
        teachers={teachers}
        mayManage={mayManage}
      />
    </>
  );
}
