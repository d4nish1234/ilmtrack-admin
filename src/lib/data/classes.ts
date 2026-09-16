import 'server-only';

import { getAdminDb } from '@/lib/firebase-admin';
import type { Class, Student, User } from '@/types';
import type { Session } from '@/lib/auth/session';

/**
 * Read queries for the portal. Every function takes the caller's Session so
 * that a future narrower role (e.g. organization-owner) can be scoped here,
 * in one place, rather than in each page.
 */

/**
 * The one place class visibility is decided.
 *
 * Reads the class document itself rather than any denormalized array, so it
 * stays correct even when users/{uid}.adminClassIds has drifted — which does
 * happen; see the "accepted but no userId" case the detail page flags.
 */
function canSeeClass(session: Session, cls: Pick<Class, 'teacherId' | 'admins'>): boolean {
  switch (session.role) {
    case 'super-admin':
      return true;
    case 'teacher':
      // Owner, or a co-teacher who has actually accepted. A pending invite
      // grants nothing — it matches no data in the app either.
      return (
        cls.teacherId === session.uid ||
        (cls.admins || []).some(
          (a) => a.userId === session.uid && a.inviteStatus === 'accepted'
        )
      );
    default:
      return false;
  }
}

/**
 * Every class this caller may see, as raw documents. The scoped fetch behind
 * both listClasses() and the header class picker.
 *
 * A super-admin scans the collection. A teacher never does: their own classes
 * come from an indexed equality query, and their co-taught ones from the
 * adminClassIds array on their user doc — a lookup hint only, since every
 * candidate is still put through canSeeClass() above.
 */
export async function visibleClassDocs(session: Session): Promise<Class[]> {
  const db = getAdminDb();

  if (session.role === 'super-admin') {
    const snap = await db.collection('classes').get();
    return snap.docs.map((d) => ({ ...(d.data() as Class), id: d.id }));
  }

  const [ownedSnap, userSnap] = await Promise.all([
    db.collection('classes').where('teacherId', '==', session.uid).get(),
    db.collection('users').doc(session.uid).get(),
  ]);

  const byId = new Map<string, Class>();
  for (const d of ownedSnap.docs) byId.set(d.id, { ...(d.data() as Class), id: d.id });

  const coTaughtIds = ((userSnap.data() as User | undefined)?.adminClassIds || []).filter(
    (id) => id && !byId.has(id)
  );
  if (coTaughtIds.length > 0) {
    const refs = [...new Set(coTaughtIds)].map((id) => db.collection('classes').doc(id));
    for (const snap of await db.getAll(...refs)) {
      if (snap.exists) byId.set(snap.id, { ...(snap.data() as Class), id: snap.id });
    }
  }

  return [...byId.values()].filter((cls) => canSeeClass(session, cls));
}

/**
 * One class, if this caller may see it — the guard every class-scoped page and
 * route handler starts with. Returns null rather than throwing so callers can
 * answer with notFound(): a teacher probing another teacher's class id must
 * not be able to tell "forbidden" apart from "does not exist".
 */
export async function getVisibleClass(session: Session, classId: string): Promise<Class | null> {
  const snap = await getAdminDb().collection('classes').doc(classId).get();
  if (!snap.exists) return null;

  const cls = { ...(snap.data() as Class), id: snap.id };
  return canSeeClass(session, cls) ? cls : null;
}

/** A class as it appears in the header picker. */
export interface ClassOption {
  id: string;
  name: string;
}

export async function listVisibleClasses(session: Session): Promise<ClassOption[]> {
  const classes = await visibleClassDocs(session);
  return classes
    .map((c) => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface ClassRow {
  id: string;
  name: string;
  description?: string;
  teacherId: string;
  ownerName: string;
  ownerEmail: string;
  studentCount: number;
  coTeacherCount: number;
}

function displayName(user: User | undefined, fallback: string): string {
  if (!user) return fallback;
  const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  return name || user.email || fallback;
}

async function loadUsers(uids: string[]): Promise<Map<string, User>> {
  const db = getAdminDb();
  const unique = [...new Set(uids.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const refs = unique.map((uid) => db.collection('users').doc(uid));
  const snaps = await db.getAll(...refs);

  const users = new Map<string, User>();
  for (const snap of snaps) {
    if (snap.exists) users.set(snap.id, { ...(snap.data() as User), uid: snap.id });
  }
  return users;
}

export async function listClasses(session: Session): Promise<ClassRow[]> {
  // Already scoped, so the owner lookup below never fetches a user this
  // caller has no business seeing.
  const classes = await visibleClassDocs(session);
  const owners = await loadUsers(classes.map((c) => c.teacherId));

  const rows = classes.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    teacherId: c.teacherId,
    ownerName: displayName(owners.get(c.teacherId), 'Unknown owner'),
    ownerEmail: owners.get(c.teacherId)?.email ?? '—',
    studentCount: c.studentCount ?? 0,
    coTeacherCount: (c.admins || []).length,
  }));

  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

export interface CoTeacherRow {
  email: string;
  userId?: string;
  name: string;
  inviteStatus: string;
  /** True when the entry says "accepted" but carries no uid — a broken link. */
  inconsistent: boolean;
}

export interface ClassDetail {
  id: string;
  name: string;
  description?: string;
  owner: { uid: string; name: string; email: string };
  coTeachers: CoTeacherRow[];
  students: Array<{
    id: string;
    name: string;
    parents: Array<{ name: string; email: string; inviteStatus: string }>;
  }>;
}

export async function getClassDetail(
  session: Session,
  classId: string
): Promise<ClassDetail | null> {
  const db = getAdminDb();

  // Same visibility rule as the list — a narrower role gets a 404 here.
  const data = await getVisibleClass(session, classId);
  if (!data) return null;

  const admins = data.admins || [];
  const users = await loadUsers([
    data.teacherId,
    ...admins.map((a) => a.userId).filter((u): u is string => Boolean(u)),
  ]);

  const studentsSnap = await db
    .collection('students')
    .where('classId', '==', classId)
    .get();

  const students = studentsSnap.docs
    .map((d) => {
      const s = d.data() as Student;
      return {
        id: d.id,
        name: `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() || '(no name)',
        parents: (s.parents || []).map((p) => ({
          name: `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || '(no name)',
          email: p.email,
          inviteStatus: p.inviteStatus,
        })),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const owner = users.get(data.teacherId);

  return {
    id: data.id,
    name: data.name,
    description: data.description,
    owner: {
      uid: data.teacherId,
      name: displayName(owner, 'Unknown owner'),
      email: owner?.email ?? '—',
    },
    coTeachers: admins.map((a) => ({
      email: a.email,
      userId: a.userId,
      name: displayName(a.userId ? users.get(a.userId) : undefined, '—'),
      inviteStatus: a.inviteStatus,
      inconsistent: a.inviteStatus === 'accepted' && !a.userId,
    })),
    students,
  };
}
