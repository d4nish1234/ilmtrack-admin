import 'server-only';

import { getAdminDb } from '@/lib/firebase-admin';
import { adminEmails } from '@/lib/auth/session';
import type { Class, Organization, Student, User } from '@/types';

/**
 * Everyone in the system, in one list: teachers, parents, admins and students.
 *
 * A row is a *person*, but people come from two places. Teachers and parents
 * have `users` documents because they signed in; students have `students`
 * documents and no account at all — they are records, with parents attached by
 * email. Both are shown because "who is in this organization" is the question
 * being asked, and a student is the reason the rest of them are there.
 *
 * `kind` keeps the distinction visible rather than papering over it: a student
 * row has no uid to act on, so nothing that acts on an account is offered for
 * one.
 *
 * Everything is loaded and joined in memory. At the current scale (62 students,
 * 46 accounts, 13 classes) that is four collection reads against a console used
 * by a handful of people. If it ever stops being cheap, the fix is to paginate
 * by class, not to denormalize — see what the access arrays cost in
 * ../ilmTrack/todo.md #6.
 */

export type DirectoryRole = 'super-admin' | 'org-admin' | 'teacher' | 'parent' | 'student';

export interface DirectoryRow {
  /** 'account' rows have a uid and can be acted on; 'student' rows cannot. */
  kind: 'account' | 'student';
  id: string;
  name: string;
  email: string | null;
  /** A person can hold several at once — a teacher who administers an org. */
  roles: DirectoryRole[];
  /** Organizations this person touches, however they touch them. */
  orgIds: string[];
  /** Classes, or for a student their class and parents. */
  detail: string;
}

export interface Directory {
  rows: DirectoryRow[];
  orgs: Array<{ id: string; name: string }>;
}

const displayName = (first?: string, last?: string, fallback = '(no name)') =>
  `${first ?? ''} ${last ?? ''}`.trim() || fallback;

export async function loadDirectory(): Promise<Directory> {
  const db = getAdminDb();
  const [usersSnap, studentsSnap, classesSnap, orgsSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('students').get(),
    db.collection('classes').get(),
    db.collection('organizations').get(),
  ]);

  const classes = new Map(
    classesSnap.docs.map((d) => [d.id, { ...(d.data() as Class), id: d.id }])
  );
  const orgs = orgsSnap.docs.map((d) => ({
    id: d.id,
    name: (d.data() as Organization).name,
  }));

  /** Which organizations administer a class, if any. */
  const orgOfClass = (classId?: string) => {
    const orgId = classId ? classes.get(classId)?.orgId : undefined;
    return orgId ? [orgId] : [];
  };

  /** uid -> organizations they administer, from the org documents. */
  const adminOf = new Map<string, string[]>();
  for (const d of orgsSnap.docs) {
    for (const uid of ((d.data() as Organization).memberUserIds || [])) {
      adminOf.set(uid, [...(adminOf.get(uid) || []), d.id]);
    }
  }

  /** uid -> the classes they teach or co-teach. */
  const teaches = new Map<string, Class[]>();
  for (const cls of classes.values()) {
    const uids = [
      cls.teacherId,
      ...(cls.admins || [])
        .filter((a) => a.userId && a.inviteStatus === 'accepted')
        .map((a) => a.userId!),
    ];
    for (const uid of uids) teaches.set(uid, [...(teaches.get(uid) || []), cls]);
  }

  /** uid -> the students they parent. */
  const parents = new Map<string, Student[]>();
  for (const d of studentsSnap.docs) {
    const s = { ...(d.data() as Student), id: d.id };
    for (const uid of (s.parentUserIds || [])) {
      parents.set(uid, [...(parents.get(uid) || []), s]);
    }
  }

  const allowlisted = new Set(adminEmails());
  const rows: DirectoryRow[] = [];

  for (const d of usersSnap.docs) {
    const u = d.data() as User;
    const email = (u.email || '').toLowerCase();
    const taught = teaches.get(d.id) || [];
    const children = parents.get(d.id) || [];
    const administers = adminOf.get(d.id) || [];

    const roles: DirectoryRole[] = [];
    if (email && allowlisted.has(email)) roles.push('super-admin');
    if (administers.length > 0) roles.push('org-admin');
    if (u.role === 'teacher') roles.push('teacher');
    if (u.role === 'parent') roles.push('parent');

    const detail = [
      taught.length > 0 && `teaches ${taught.map((c) => c.name).join(', ')}`,
      children.length > 0 &&
        `parent of ${children.map((s) => displayName(s.firstName, s.lastName)).join(', ')}`,
    ]
      .filter(Boolean)
      .join(' · ');

    rows.push({
      kind: 'account',
      id: d.id,
      name: displayName(u.firstName, u.lastName, email || '(no name)'),
      email: u.email ?? null,
      roles,
      orgIds: [
        ...new Set([...administers, ...taught.flatMap((c) => orgOfClass(c.id)),
          ...children.flatMap((s) => orgOfClass(s.classId))]),
      ],
      detail: detail || '—',
    });
  }

  for (const d of studentsSnap.docs) {
    const s = d.data() as Student;
    const cls = s.classId ? classes.get(s.classId) : undefined;
    rows.push({
      kind: 'student',
      id: d.id,
      name: displayName(s.firstName, s.lastName),
      email: null,
      roles: ['student'],
      orgIds: orgOfClass(s.classId),
      detail: [
        cls ? `in ${cls.name}` : 'in no class',
        (s.parents || []).length > 0 &&
          `parents ${(s.parents || []).map((p) => p.email).join(', ')}`,
      ]
        .filter(Boolean)
        .join(' · '),
    });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { rows, orgs };
}
