/**
 * Who may see which class, and what a report contains.
 *
 * Runs against the Firestore emulator — never production. Start it first:
 *
 *   cd ../ilmTrack && firebase emulators:start --only firestore
 *   cd ../ilmTrack-admin && npm test
 *
 * These tests drive the real data layer, so they exercise getAdminDb() in its
 * emulator mode. The env vars below must be set before that module is
 * imported, which is why the imports are dynamic.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';

const PROJECT_ID = 'ilmtrack-admin-test';
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

process.env.FIRESTORE_EMULATOR_HOST = EMULATOR;
process.env.FIREBASE_USE_EMULATOR = 'true';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = PROJECT_ID;

type Mod = {
  classes: typeof import('@/lib/data/classes');
  reports: typeof import('@/lib/data/reports');
  range: typeof import('@/lib/reports/range');
  admin: typeof import('@/lib/firebase-admin');
};

let mod: Mod;
let db: import('firebase-admin/firestore').Firestore;

const OWNER = { uid: 'owner-uid', email: 'owner@example.com', role: 'teacher' as const };
const CO_TEACHER = { uid: 'co-uid', email: 'co@example.com', role: 'teacher' as const };
const PENDING = { uid: 'pending-uid', email: 'pending@example.com', role: 'teacher' as const };
const OUTSIDER = { uid: 'outsider-uid', email: 'outsider@example.com', role: 'teacher' as const };
const ADMIN = { uid: 'admin-uid', email: 'admin@example.com', role: 'super-admin' as const };

const OURS = 'class-ours';
const THEIRS = 'class-theirs';

beforeAll(async () => {
  mod = {
    classes: await import('@/lib/data/classes'),
    reports: await import('@/lib/data/reports'),
    range: await import('@/lib/reports/range'),
    admin: await import('@/lib/firebase-admin'),
  };
  db = mod.admin.getAdminDb();
});

async function clearFirestore() {
  const response = await fetch(
    `http://${EMULATOR}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' }
  );
  if (!response.ok) {
    throw new Error(
      `Could not clear the Firestore emulator at ${EMULATOR}. Is it running? ` +
        '(cd ../ilmTrack && firebase emulators:start --only firestore)'
    );
  }
}

const day = (d: number) => Timestamp.fromDate(new Date(2026, 8, d)); // September 2026
const now = () => Timestamp.fromDate(new Date(2026, 8, 20));

async function seed() {
  // Our class: owned by OWNER, CO_TEACHER accepted, PENDING still invited.
  await db.collection('classes').doc(OURS).set({
    name: 'Grade 3 Qur’an',
    teacherId: OWNER.uid,
    studentCount: 2,
    admins: [
      { email: CO_TEACHER.email, userId: CO_TEACHER.uid, inviteStatus: 'accepted', inviteSentAt: now() },
      { email: PENDING.email, userId: PENDING.uid, inviteStatus: 'pending', inviteSentAt: now() },
    ],
    createdAt: now(),
    updatedAt: now(),
  });

  // Someone else's class, which no teacher above may see.
  await db.collection('classes').doc(THEIRS).set({
    name: 'Grade 5 Fiqh',
    teacherId: 'other-owner',
    studentCount: 1,
    admins: [],
    createdAt: now(),
    updatedAt: now(),
  });

  // The app maintains adminClassIds; both accepted and pending co-teachers get
  // a user doc so we can prove the class document, not this array, decides.
  for (const [user, adminClassIds] of [
    [OWNER, []],
    [CO_TEACHER, [OURS]],
    [PENDING, [OURS]],
    [OUTSIDER, []],
  ] as const) {
    await db.collection('users').doc(user.uid).set({
      uid: user.uid,
      email: user.email,
      firstName: 'T',
      lastName: user.uid,
      role: 'teacher',
      adminClassIds,
      createdAt: now(),
      updatedAt: now(),
    });
  }

  await db.collection('students').doc('s1').set({
    firstName: 'Ali', lastName: 'Khan', classId: OURS, teacherId: OWNER.uid,
    parents: [], createdAt: now(), updatedAt: now(),
  });
  await db.collection('students').doc('s2').set({
    firstName: 'Zayd', lastName: 'Omar', classId: OURS, teacherId: OWNER.uid,
    parents: [], createdAt: now(), updatedAt: now(),
  });
  await db.collection('students').doc('s3').set({
    firstName: 'Other', lastName: 'Pupil', classId: THEIRS, teacherId: 'other-owner',
    parents: [], createdAt: now(), updatedAt: now(),
  });

  // Inside the window we query (Sep 10–20) and outside it (Sep 1).
  await db.collection('attendance').doc('a-in').set({
    studentId: 's1', classId: OURS, teacherId: OWNER.uid, status: 'present',
    date: day(12), createdAt: day(12), updatedAt: day(12),
  });
  await db.collection('attendance').doc('a-edge').set({
    studentId: 's2', classId: OURS, teacherId: OWNER.uid, status: 'absent',
    date: day(10), createdAt: day(10), updatedAt: day(10),
  });
  await db.collection('attendance').doc('a-out').set({
    studentId: 's1', classId: OURS, teacherId: OWNER.uid, status: 'present',
    date: day(1), createdAt: day(1), updatedAt: day(1),
  });
  // Created by the co-teacher, so teacherId is not the owner. A report must
  // still include it — this is the case the app's own query misses.
  await db.collection('attendance').doc('a-by-co').set({
    studentId: 's1', classId: OURS, teacherId: CO_TEACHER.uid, status: 'late',
    date: day(13), createdAt: day(13), updatedAt: day(13),
  });

  await db.collection('homework').doc('h-in').set({
    studentId: 's1', classId: OURS, teacherId: OWNER.uid, title: 'Al-Fatiha',
    status: 'completed', evaluation: 5, createdAt: day(11), updatedAt: day(11),
  });
  await db.collection('homework').doc('h-out').set({
    studentId: 's1', classId: OURS, teacherId: OWNER.uid, title: 'Al-Baqarah',
    status: 'assigned', createdAt: day(2), updatedAt: day(2),
  });
}

beforeEach(async () => {
  await clearFirestore();
  await seed();
});

const WINDOW = () => mod.range.parseRange({ from: '2026-09-10', to: '2026-09-20' });

describe('class visibility', () => {
  it('shows an owner their own class and nobody else’s', async () => {
    const visible = await mod.classes.listVisibleClasses(OWNER);
    expect(visible.map((c) => c.id)).toEqual([OURS]);
  });

  it('shows an accepted co-teacher the class they were added to', async () => {
    const visible = await mod.classes.listVisibleClasses(CO_TEACHER);
    expect(visible.map((c) => c.id)).toEqual([OURS]);
  });

  it('shows a pending co-teacher nothing, even though adminClassIds lists the class', async () => {
    const user = await db.collection('users').doc(PENDING.uid).get();
    expect(user.data()!.adminClassIds).toEqual([OURS]);

    // The class document is the authority, and its invite is still pending.
    expect(await mod.classes.listVisibleClasses(PENDING)).toEqual([]);
    expect(await mod.classes.getVisibleClass(PENDING, OURS)).toBeNull();
  });

  it('shows an unrelated teacher nothing', async () => {
    expect(await mod.classes.listVisibleClasses(OUTSIDER)).toEqual([]);
    expect(await mod.classes.getVisibleClass(OUTSIDER, OURS)).toBeNull();
  });

  it('shows a super-admin every class', async () => {
    const visible = await mod.classes.listVisibleClasses(ADMIN);
    expect(visible.map((c) => c.id).sort()).toEqual([OURS, THEIRS]);
  });

  it('returns null for a class that does not exist, exactly as for a forbidden one', async () => {
    expect(await mod.classes.getVisibleClass(OWNER, 'no-such-class')).toBeNull();
    expect(await mod.classes.getVisibleClass(OWNER, THEIRS)).toBeNull();
  });
});

describe('loadClassReport', () => {
  it('refuses a class the caller may not see', async () => {
    expect(await mod.reports.loadClassReport(OUTSIDER, OURS, 'attendance', WINDOW())).toBeNull();
    expect(await mod.reports.loadClassReport(PENDING, OURS, 'summary', WINDOW())).toBeNull();
  });

  it('keeps only attendance inside the range, inclusive of both ends', async () => {
    const report = await mod.reports.loadClassReport(OWNER, OURS, 'attendance', WINDOW());
    expect(report!.rows.map((r) => r.date)).toEqual(['2026-09-10', '2026-09-12', '2026-09-13']);
  });

  it('includes records a co-teacher created, not just the owner’s', async () => {
    const report = await mod.reports.loadClassReport(OWNER, OURS, 'attendance', WINDOW());
    expect(report!.rows.find((r) => r.status === 'late')).toBeTruthy();
  });

  it('gives an owner and a co-teacher the same report', async () => {
    const asOwner = await mod.reports.loadClassReport(OWNER, OURS, 'summary', WINDOW());
    const asCoTeacher = await mod.reports.loadClassReport(CO_TEACHER, OURS, 'summary', WINDOW());
    expect(asCoTeacher!.rows).toEqual(asOwner!.rows);
  });

  it('filters homework on createdAt', async () => {
    const report = await mod.reports.loadClassReport(OWNER, OURS, 'homework', WINDOW());
    expect(report!.rows).toHaveLength(1);
    expect(report!.rows[0].title).toBe('Al-Fatiha');
  });

  it('never reaches into another class', async () => {
    const report = await mod.reports.loadClassReport(ADMIN, OURS, 'summary', WINDOW());
    expect(report!.rows.map((r) => r.studentName)).toEqual(['Ali Khan', 'Zayd Omar']);
  });

  it('summarizes every student, with a totals row', async () => {
    const report = await mod.reports.loadClassReport(OWNER, OURS, 'summary', WINDOW());
    const ali = report!.rows.find((r) => r.studentName === 'Ali Khan')!;
    expect(ali.totalPresent).toBe(1);
    expect(ali.totalStars).toBe(5);
    // The out-of-range homework is excluded, so Ali has one item, not two.
    expect(ali.totalHomework).toBe(1);
    expect(report!.totalsRow!.totalPresent).toBe(1);
    expect(report!.totalsRow!.totalAbsent).toBe(1);
  });

});
