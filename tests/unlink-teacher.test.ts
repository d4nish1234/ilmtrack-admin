/**
 * Tests for unlinkTeacherFromClass — the repair half of the co-teacher tools.
 *
 * Runs against the Firestore emulator — never production. Start it first:
 *
 *   cd ../ilmTrack && firebase emulators:start --only firestore
 *   cd ../ilmTrack-admin && npm test
 *
 * No Cloud Functions are attached here, which is the point for two of these:
 * the action must close the rules gate (`adminUserIds`) and strip
 * `invitedTeacherIds` on its own, without waiting for syncClassAdminUserIds or
 * onTeacherRemoved to do it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { linkTeacherToClass } from '@/lib/actions/link-teacher';
import { UnlinkTeacherError, unlinkTeacherFromClass } from '@/lib/actions/unlink-teacher';

const PROJECT_ID = 'ilmtrack-admin-test';
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIRESTORE_EMULATOR_HOST = EMULATOR;

const app = initializeApp({ projectId: PROJECT_ID }, `unlink-test-${Date.now()}`);
const db: Firestore = getFirestore(app);

const ACTOR = { uid: 'admin-uid', email: 'admin@example.com' };
const OWNER = 'owner-uid';
const TEACHER = 'teacher-uid';
const TEACHER_EMAIL = 'coteacher@example.com';
const CLASS_ID = 'class-1';

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

/** Seeds a class with `studentCount` students plus one homework and attendance doc. */
async function seed({ studentCount = 2, adminUid = TEACHER } = {}) {
  const now = Timestamp.now();

  await db.collection('users').doc(OWNER).set({
    uid: OWNER, email: 'owner@example.com', firstName: 'Owner', lastName: 'Teacher',
    role: 'teacher', classIds: [CLASS_ID], createdAt: now, updatedAt: now,
  });
  await db.collection('users').doc(TEACHER).set({
    uid: TEACHER, email: TEACHER_EMAIL, firstName: 'Co', lastName: 'Teacher',
    role: 'teacher', adminClassIds: [CLASS_ID], createdAt: now, updatedAt: now,
  });

  await db.collection('classes').doc(CLASS_ID).set({
    name: 'Hifz A',
    teacherId: OWNER,
    admins: [
      { email: TEACHER_EMAIL, userId: adminUid, inviteStatus: 'accepted', inviteSentAt: now, acceptedAt: now },
    ],
    adminUserIds: [OWNER, adminUid],
    studentCount,
    createdAt: now,
    updatedAt: now,
  });

  for (let i = 0; i < studentCount; i++) {
    await db.collection('students').doc(`student-${i}`).set({
      firstName: 'Student', lastName: `${i}`, classId: CLASS_ID, teacherId: OWNER,
      parents: [], invitedTeacherIds: [OWNER, adminUid], createdAt: now, updatedAt: now,
    });
  }
  await db.collection('homework').doc('hw-1').set({
    studentId: 'student-0', classId: CLASS_ID, teacherId: OWNER, title: 'Surah Al-Fatiha',
    status: 'assigned', invitedTeacherIds: [OWNER, adminUid], createdAt: now, updatedAt: now,
  });
  await db.collection('attendance').doc('att-1').set({
    studentId: 'student-0', classId: CLASS_ID, teacherId: OWNER, date: now,
    status: 'present', invitedTeacherIds: [OWNER, adminUid], createdAt: now, updatedAt: now,
  });
  await db.collection('adminInvites').add({
    email: TEACHER_EMAIL, classId: CLASS_ID, status: 'accepted', userId: adminUid, createdAt: now,
  });
}

const unlink = (overrides: Partial<Parameters<typeof unlinkTeacherFromClass>[1]> = {}) =>
  unlinkTeacherFromClass(db, {
    classId: CLASS_ID,
    teacherEmail: TEACHER_EMAIL,
    actor: ACTOR,
    ...overrides,
  });

const classDoc = async () => (await db.collection('classes').doc(CLASS_ID).get()).data()!;
const invitedOn = async (col: string, id: string) =>
  (await db.collection(col).doc(id).get()).data()!.invitedTeacherIds as string[];

beforeAll(clearFirestore);
beforeEach(clearFirestore);
afterAll(async () => { await deleteApp(app); });

describe('unlinkTeacherFromClass', () => {
  it('removes the admins entry and revokes access everywhere', async () => {
    await seed();
    const result = await unlink();

    const data = await classDoc();
    expect(data.admins).toEqual([]);
    expect(result.removedUserId).toBe(TEACHER);

    expect(await invitedOn('students', 'student-0')).toEqual([OWNER]);
    expect(await invitedOn('students', 'student-1')).toEqual([OWNER]);
    expect(await invitedOn('homework', 'hw-1')).toEqual([OWNER]);
    expect(await invitedOn('attendance', 'att-1')).toEqual([OWNER]);
  });

  it('closes the rules gate itself rather than waiting for the sync trigger', async () => {
    await seed();
    await unlink();
    // No Cloud Functions here, so this can only have been written by the action.
    expect((await classDoc()).adminUserIds).toEqual([OWNER]);
  });

  it('drops the class from the teacher lookup hint', async () => {
    await seed();
    await unlink();
    const user = (await db.collection('users').doc(TEACHER).get()).data()!;
    expect(user.adminClassIds).toEqual([]);
  });

  it('deletes the invite, so a later re-link can fire the accept trigger again', async () => {
    await seed();
    await unlink();
    const invites = await db.collection('adminInvites').where('email', '==', TEACHER_EMAIL).get();
    expect(invites.size).toBe(0);
  });

  it('matches on email even when the stored uid is a deleted account', async () => {
    // The repair case: admins[].userId names a uid with no users document.
    await seed({ adminUid: 'deleted-uid' });
    const result = await unlink();

    expect(result.removedUserId).toBe('deleted-uid');
    expect((await classDoc()).admins).toEqual([]);
    expect(await invitedOn('students', 'student-0')).toEqual([OWNER]);
  });

  it('is safe to run twice — the second run reports the entry is gone', async () => {
    await seed();
    await unlink();
    await expect(unlink()).rejects.toThrow(UnlinkTeacherError);
    // ...and nothing was damaged by the attempt.
    expect(await invitedOn('students', 'student-0')).toEqual([OWNER]);
  });

  it('round-trips: unlink then link restores access under a new uid', async () => {
    await seed({ adminUid: 'deleted-uid' });
    await unlink();
    await linkTeacherToClass(db, { classId: CLASS_ID, teacherUserId: TEACHER, actor: ACTOR });

    const data = await classDoc();
    expect(data.admins).toHaveLength(1);
    expect(data.admins[0].userId).toBe(TEACHER);
    expect(await invitedOn('students', 'student-0')).toContain(TEACHER);
    expect(await invitedOn('students', 'student-0')).not.toContain('deleted-uid');
  });

  it('refuses to unlink the owner', async () => {
    await seed();
    const now = Timestamp.now();
    await db.collection('classes').doc(CLASS_ID).update({
      admins: [{ email: 'owner@example.com', userId: OWNER, inviteStatus: 'accepted', inviteSentAt: now }],
    });
    await expect(unlink({ teacherEmail: 'owner@example.com' })).rejects.toThrow(/owns this class/);
    expect(await invitedOn('students', 'student-0')).toContain(OWNER);
  });

  it('keeps access when a second entry still names the same uid', async () => {
    await seed();
    const now = Timestamp.now();
    const data = await classDoc();
    await db.collection('classes').doc(CLASS_ID).update({
      admins: [...data.admins, { email: 'alias@example.com', userId: TEACHER, inviteStatus: 'accepted', inviteSentAt: now }],
    });

    const result = await unlink();
    expect(result.stripped.students).toBe(0);
    expect(await invitedOn('students', 'student-0')).toContain(TEACHER);
    expect((await classDoc()).adminUserIds).toContain(TEACHER);
  });

  it('rejects an email that is not on the class', async () => {
    await seed();
    await expect(unlink({ teacherEmail: 'nobody@example.com' })).rejects.toThrow(UnlinkTeacherError);
  });

  it('rejects an unknown class', async () => {
    await seed();
    await expect(unlink({ classId: 'nope' })).rejects.toThrow(/not found/);
  });

  it('writes an audit entry', async () => {
    await seed();
    await unlink();
    const log = await db.collection('adminAuditLog').where('action', '==', 'class.unlinkTeacher').get();
    expect(log.size).toBe(1);
    expect(log.docs[0].data()).toMatchObject({
      actorEmail: ACTOR.email, classId: CLASS_ID, targetEmail: TEACHER_EMAIL, targetUserId: TEACHER,
    });
  });
});
