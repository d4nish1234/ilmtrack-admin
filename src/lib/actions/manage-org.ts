import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { deriveMemberUserIds } from '@/lib/data/organizations';
import type { OrgMember, OrgRole, Organization, User } from '@/types';

/**
 * Create organizations and decide who administers them.
 *
 * Super-admin only. There is deliberately no self-serve path: who owns an
 * organization, and what happens to its classes when that person leaves, are
 * product questions that do not need answering while the model settles.
 *
 * Membership is stored here rather than in a custom claim so that removing an
 * admin takes effect on their next request instead of their next token
 * refresh. An admin can move students between classes; revocation lag is not
 * acceptable for that. See src/lib/data/organizations.ts.
 *
 * Every mutation rewrites `members` and `memberUserIds` together, in one
 * write, so the derived array cannot drift from its source.
 */

export class ManageOrgError extends Error {}

export interface Actor {
  uid: string;
  email: string;
}

async function audit(
  db: Firestore,
  action: string,
  actor: Actor,
  details: Record<string, unknown>
): Promise<void> {
  await db.collection('adminAuditLog').add({
    action,
    actorUid: actor.uid,
    actorEmail: actor.email,
    ...details,
    createdAt: FieldValue.serverTimestamp(),
  });
}

export async function createOrganization(
  db: Firestore,
  { name, actor }: { name: string; actor: Actor }
): Promise<{ id: string; name: string }> {
  const trimmed = name.trim();
  if (!trimmed) throw new ManageOrgError('Give the organization a name.');
  if (trimmed.length > 120) throw new ManageOrgError('That name is too long.');

  const existing = await db.collection('organizations').where('name', '==', trimmed).get();
  if (!existing.empty) {
    throw new ManageOrgError(`An organization called "${trimmed}" already exists.`);
  }

  const ref = await db.collection('organizations').add({
    name: trimmed,
    members: [],
    memberUserIds: [],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await audit(db, 'org.create', actor, { orgId: ref.id, name: trimmed });
  return { id: ref.id, name: trimmed };
}

/**
 * Add or replace a member. Keyed on uid, and the caller passes a uid rather
 * than an email, because the uid is what every authorization check compares —
 * resolving it here from a typed address would make a typo a silent no-op.
 */
export async function setOrgMember(
  db: Firestore,
  { orgId, userId, role, actor }: { orgId: string; userId: string; role: OrgRole; actor: Actor }
): Promise<{ members: OrgMember[] }> {
  const orgRef = db.collection('organizations').doc(orgId);
  const [orgSnap, userSnap] = await Promise.all([
    orgRef.get(),
    db.collection('users').doc(userId).get(),
  ]);

  if (!orgSnap.exists) throw new ManageOrgError('That organization no longer exists.');
  if (!userSnap.exists) throw new ManageOrgError('That user has no ilmTrack account.');

  const user = userSnap.data() as User;
  if (user.role !== 'teacher') {
    throw new ManageOrgError(
      `${user.email} is a ${user.role}. Only teachers can administer an organization.`
    );
  }

  const current = (orgSnap.data() as Organization).members || [];
  const members = [
    ...current.filter((m) => m.userId !== userId),
    { userId, email: user.email.toLowerCase(), role },
  ].sort((a, b) => a.email.localeCompare(b.email));

  await orgRef.update({
    members,
    memberUserIds: deriveMemberUserIds(members),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await audit(db, 'org.setMember', actor, { orgId, targetUserId: userId, targetEmail: user.email, role });
  return { members };
}

export async function removeOrgMember(
  db: Firestore,
  { orgId, userId, actor }: { orgId: string; userId: string; actor: Actor }
): Promise<{ members: OrgMember[] }> {
  const orgRef = db.collection('organizations').doc(orgId);
  const orgSnap = await orgRef.get();
  if (!orgSnap.exists) throw new ManageOrgError('That organization no longer exists.');

  const current = (orgSnap.data() as Organization).members || [];
  const going = current.find((m) => m.userId === userId);
  if (!going) throw new ManageOrgError('That person does not administer this organization.');

  const members = current.filter((m) => m.userId !== userId);

  // An organization with no owner cannot be handed on, and its classes would
  // be administrable by nobody but a super-admin.
  if (going.role === 'owner' && !members.some((m) => m.role === 'owner')) {
    throw new ManageOrgError(
      'That is the last owner. Make someone else an owner first, then remove them.'
    );
  }

  await orgRef.update({
    members,
    memberUserIds: deriveMemberUserIds(members),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await audit(db, 'org.removeMember', actor, { orgId, targetUserId: userId, targetEmail: going.email });
  return { members };
}

/** Put a class in an organization, or take it out when orgId is null. */
export async function setClassOrg(
  db: Firestore,
  { classId, orgId, actor }: { classId: string; orgId: string | null; actor: Actor }
): Promise<void> {
  const classRef = db.collection('classes').doc(classId);
  const classSnap = await classRef.get();
  if (!classSnap.exists) throw new ManageOrgError('That class no longer exists.');

  if (orgId && !(await db.collection('organizations').doc(orgId).get()).exists) {
    throw new ManageOrgError('That organization no longer exists.');
  }

  await classRef.update({
    orgId: orgId ?? FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await audit(db, 'org.setClassOrg', actor, {
    classId,
    className: classSnap.data()!.name,
    orgId,
  });
}
