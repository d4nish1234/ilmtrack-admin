/**
 * Tests for the one mutation this portal performs.
 *
 * Runs against the Firestore emulator — never production. Start it first:
 *
 *   cd ../ilmTrack && firebase emulators:start --only firestore
 *   cd ../ilmTrack-admin && npm test
 *
 * Note the emulator has no Cloud Functions attached here, so this verifies
 * the writes only; the invite email is checked by hand during the end-to-end
 * pass described in the README.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { LinkTeacherError, linkTeacherToClass } from '@/lib/actions/link-teacher';

const PROJECT_ID = 'ilmtrack-admin-test';
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

process.env.FIRESTORE_EMULATOR_HOST = EMULATOR;

const app = initializeApp({ projectId: PROJECT_ID }, `test-${Date.now()}`);
const db: Firestore = getFirestore(app);

const ACTOR = { uid: 'admin-uid', email: 'admin@example.com' };
const OWNER = 'owner-uid';
const TEACHER = 'teacher-uid';
const CLASS_ID = 'class-1';

/** Wipe the emulator project between tests. */
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

async function seed({ studentCount = 2 } = {}) {
  const now = Timestamp.now();

  await db.collection('users').doc(OWNER).set({
    uid: OWNER,
    email: 'owner@example.com',
    firstName: 'Owner',
    lastName: 'Teacher',
    role: 'teacher',
    classIds: [CLASS_ID],
    createdAt: now,
    updatedAt: now,
  });

  await db.collection('users').doc(TEACHER).set({
    uid: TEACHER,
    email: 'CoTeacher@Example.com', // deliberately mixed case
    firstName: 'Co',
    lastName: 'Teacher',
    role: 'teacher',
    createdAt: now,
    updatedAt: now,
  });

  await db.collection('classes').doc(CLASS_ID).set({
    name: 'Hifz A',
    teacherId: OWNER,
    admins: [],
    studentCount,
    createdAt: now,
    updatedAt: now,
  });

  for (let i = 0; i < studentCount; i++) {
    await db.collection('students').doc(`student-${i}`).set({
      firstName: 'Student',
      lastName: `${i}`,
      classId: CLASS_ID,
      teacherId: OWNER,
      parents: [],
      invitedTeacherIds: [OWNER],
      createdAt: now,
      updatedAt: now,
    });
  }

  await db.collection('homework').doc('hw-1').set({
    studentId: 'student-0',
    classId: CLASS_ID,
    teacherId: OWNER,
    title: 'Surah Al-Fatiha',
    status: 'assigned',
    invitedTeacherIds: [OWNER],
    createdAt: now,
    updatedAt: now,
  });

  await db.collection('attendance').doc('att-1').set({
    studentId: 'student-0',
    classId: CLASS_ID,
    teacherId: OWNER,
    date: now,
    status: 'present',
    invitedTeacherIds: [OWNER],
    createdAt: now,
    updatedAt: now,
  });
}

const link = (overrides: Partial<Parameters<typeof linkTeacherToClass>[1]> = {}) =>
  linkTeacherToClass(db, {
    classId: CLASS_ID,
    teacherUserId: TEACHER,
    actor: ACTOR,
    ...overrides,
  });

beforeAll(clearFirestore);
beforeEach(async () => {
  await clearFirestore();
  await seed();
});
afterAll(async () => {
  await clearFirestore();
  await deleteApp(app);
});

describe('linkTeacherToClass', () => {
  it('adds an accepted co-teacher entry to the class', async () => {
    await link();

    const admins = (await db.collection('classes').doc(CLASS_ID).get()).get('admins');
    expect(admins).toHaveLength(1);
    expect(admins[0]).toMatchObject({
      email: 'coteacher@example.com', // normalized to lowercase
      userId: TEACHER,
      inviteStatus: 'accepted',
    });
    expect(admins[0].acceptedAt).toBeDefined();
  });

  it("adds the class to the teacher's adminClassIds", async () => {
    await link();

    const user = await db.collection('users').doc(TEACHER).get();
    expect(user.get('adminClassIds')).toEqual([CLASS_ID]);
  });

  it('backfills invitedTeacherIds across students, homework and attendance', async () => {
    const result = await link();

    expect(result.backfilled).toEqual({ students: 2, homework: 1, attendance: 1 });

    for (const [collection, id] of [
      ['students', 'student-0'],
      ['students', 'student-1'],
      ['homework', 'hw-1'],
      ['attendance', 'att-1'],
    ] as const) {
      const doc = await db.collection(collection).doc(id).get();
      expect(doc.get('invitedTeacherIds'), `${collection}/${id}`).toContain(TEACHER);
      // The owner must not be displaced.
      expect(doc.get('invitedTeacherIds'), `${collection}/${id}`).toContain(OWNER);
    }
  });

  it('backfills docs created by a co-teacher, not just the owner', async () => {
    // The mobile app's addAdmin filters on teacherId == owner and would miss
    // this doc. We filter on classId alone, matching the Cloud Function.
    await db.collection('students').doc('student-other').set({
      firstName: 'Added',
      lastName: 'ByCoTeacher',
      classId: CLASS_ID,
      teacherId: 'some-other-teacher-uid',
      parents: [],
      invitedTeacherIds: [],
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });

    await link();

    const doc = await db.collection('students').doc('student-other').get();
    expect(doc.get('invitedTeacherIds')).toContain(TEACHER);
  });

  it('creates an accepted adminInvites doc to trigger the invite email', async () => {
    await link();

    const invites = await db.collection('adminInvites').get();
    expect(invites.size).toBe(1);
    expect(invites.docs[0].data()).toMatchObject({
      email: 'coteacher@example.com',
      classId: CLASS_ID,
      status: 'accepted',
      userId: TEACHER,
    });
  });

  it('writes an audit log entry naming the actor', async () => {
    await link();

    const log = await db.collection('adminAuditLog').get();
    expect(log.size).toBe(1);
    expect(log.docs[0].data()).toMatchObject({
      action: 'class.linkTeacher',
      actorEmail: ACTOR.email,
      classId: CLASS_ID,
      targetUserId: TEACHER,
    });
  });

  it('chunks the backfill past the 500-write batch limit', async () => {
    const writer = db.bulkWriter();
    for (let i = 0; i < 520; i++) {
      writer.set(db.collection('students').doc(`bulk-${i}`), {
        firstName: 'Bulk',
        lastName: `${i}`,
        classId: CLASS_ID,
        teacherId: OWNER,
        parents: [],
        invitedTeacherIds: [],
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    }
    await writer.close();

    const result = await link();
    expect(result.backfilled.students).toBe(522); // 520 bulk + 2 seeded

    const spot = await db.collection('students').doc('bulk-519').get();
    expect(spot.get('invitedTeacherIds')).toContain(TEACHER);
  });

  describe('rejections', () => {
    it('refuses a teacher who is already a co-teacher', async () => {
      await link();
      await expect(link()).rejects.toThrow(LinkTeacherError);
      await expect(link()).rejects.toThrow(/already a co-teacher/);

      // And the first link is left intact.
      const admins = (await db.collection('classes').doc(CLASS_ID).get()).get('admins');
      expect(admins).toHaveLength(1);
    });

    it('refuses the class owner', async () => {
      await expect(link({ teacherUserId: OWNER })).rejects.toThrow(/already owns this class/);
    });

    it('refuses a parent account', async () => {
      await db.collection('users').doc('parent-uid').set({
        uid: 'parent-uid',
        email: 'parent@example.com',
        firstName: 'A',
        lastName: 'Parent',
        role: 'parent',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });

      await expect(link({ teacherUserId: 'parent-uid' })).rejects.toThrow(/not a teacher/);
    });

    it('refuses an unknown class or user', async () => {
      await expect(link({ classId: 'nope' })).rejects.toThrow(/Class nope not found/);
      await expect(link({ teacherUserId: 'nope' })).rejects.toThrow(/User nope not found/);
    });

    it('writes nothing when validation fails', async () => {
      await expect(link({ teacherUserId: OWNER })).rejects.toThrow();

      expect((await db.collection('adminInvites').get()).size).toBe(0);
      expect((await db.collection('adminAuditLog').get()).size).toBe(0);
      expect((await db.collection('classes').doc(CLASS_ID).get()).get('admins')).toEqual([]);
    });
  });
});
