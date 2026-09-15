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
 * The one place class visibility is decided. A future organization-owner role
 * would compare the class owner against that role's org here, and both the
 * list and the detail page would narrow automatically.
 */
function canSeeClass(session: Session, _cls: Pick<Class, 'teacherId'>): boolean {
  switch (session.role) {
    case 'super-admin':
      return true;
    default:
      return false;
  }
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
  const db = getAdminDb();
  const snap = await db.collection('classes').get();
  const classes = snap.docs.map((d) => ({ ...(d.data() as Class), id: d.id }));

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
  return rows.filter((row) => canSeeClass(session, row));
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
  const snap = await db.collection('classes').doc(classId).get();
  if (!snap.exists) return null;

  const data = { ...(snap.data() as Class), id: snap.id };

  // Same visibility rule as the list — a narrower role gets a 404 here.
  if (!canSeeClass(session, data)) return null;

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
