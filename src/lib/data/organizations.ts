import 'server-only';

import { getAdminDb } from '@/lib/firebase-admin';
import type { OrgMember, Organization } from '@/types';

/**
 * Organizations group classes so administrative rights can be granted over
 * several at once.
 *
 * Authority is read from the organization document, never from anything the
 * caller can write — the same rule that closed the escalation in
 * ../ilmTrack/todo.md #1, and why `role` on a user document is frozen.
 *
 * Membership is deliberately *not* in custom claims. Claims cap at ~1000 bytes
 * and refresh only when the token does, roughly hourly, so revoking an admin
 * who can move students between classes would lag by up to an hour. Delayed
 * grants are an annoyance; delayed revocation is a hole.
 */

/** The organizations this account administers. Empty for everyone else. */
export async function orgsForUser(uid: string): Promise<Organization[]> {
  const snap = await getAdminDb()
    .collection('organizations')
    .where('memberUserIds', 'array-contains', uid)
    .get();

  return snap.docs.map((d) => ({ ...(d.data() as Organization), id: d.id }));
}

/** Just the ids — what Session carries, since that is all authorization needs. */
export async function orgIdsForUser(uid: string): Promise<string[]> {
  return (await orgsForUser(uid)).map((o) => o.id);
}

/**
 * Every class in these organizations.
 *
 * Firestore caps an `in` filter at 30 values, which is far more organizations
 * than one person will ever administer, but the chunking costs nothing and
 * removes the cliff.
 */
export async function classIdsInOrgs(orgIds: string[]): Promise<Set<string>> {
  const ids = new Set<string>();
  if (orgIds.length === 0) return ids;

  const db = getAdminDb();
  for (let i = 0; i < orgIds.length; i += 30) {
    const snap = await db
      .collection('classes')
      .where('orgId', 'in', orgIds.slice(i, i + 30))
      .get();
    for (const d of snap.docs) ids.add(d.id);
  }
  return ids;
}

export async function getOrganization(orgId: string): Promise<Organization | null> {
  const snap = await getAdminDb().collection('organizations').doc(orgId).get();
  return snap.exists ? { ...(snap.data() as Organization), id: snap.id } : null;
}

/** Owner-only actions, such as changing who administers an organization. */
export function isOrgOwner(org: Organization, uid: string): boolean {
  return (org.members || []).some((m) => m.userId === uid && m.role === 'owner');
}

/** Every organization, for the super-admin console. */
export async function listOrganizations(): Promise<Organization[]> {
  const snap = await getAdminDb().collection('organizations').orderBy('name').get();
  return snap.docs.map((d) => ({ ...(d.data() as Organization), id: d.id }));
}

/**
 * members -> memberUserIds. The single place the derived array is computed,
 * so the console and scripts/manage-org.ts cannot disagree. Kept in the same
 * write as `members` rather than behind a trigger: a derived array that drifts
 * from its source is the bug behind ../ilmTrack/todo.md #6 and #7.
 */
export function deriveMemberUserIds(members: OrgMember[]): string[] {
  return [...new Set(members.map((m) => m.userId).filter(Boolean))].sort();
}
