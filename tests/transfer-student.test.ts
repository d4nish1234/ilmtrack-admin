/**
 * Moving a student between classes, history included.
 *
 * Runs against the Firestore emulator — never production. Start it first:
 *
 *   cd ../ilmTrack && firebase emulators:start --only firestore
 *   cd ../ilmTrack-admin && npm test
 *
 * The interesting cases are not the happy path but the ones that make this
 * safe to run twice: an interrupted transfer, and the duplicate guard.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import {
  TransferStudentError,
  transferStudentToClass,
} from '@/lib/actions/transfer-student';

const PROJECT_ID = 'ilmtrack-admin-test';
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIRESTORE_EMULATOR_HOST = EMULATOR;

const app = initializeApp({ projectId: PROJECT_ID }, `transfer-${Date.now()}`);
const db: Firestore = getFirestore(app);

const ACTOR = { uid: 'admin-uid', email: 'admin@example.com' };
const OWNER_A = 'owner-a';
const OWNER_B = 'owner-b';
const CO_B = 'co-b';
const CLASS_A = 'class-a';
const CLASS_B = 'class-b';
const STUDENT = 'student-1';

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

const now = () => Timestamp.now();

async function student(
  id: string,
  classId: string,
  teacherId: string,
  firstName: string,
  lastName: string,
  parentEmail?: string
) {
  await db.collection('students').doc(id).set({
    firstName,
    lastName,
    classId,
    teacherId,
    parents: parentEmail
      ? [{ firstName: 'P', lastName: 'Q', email: parentEmail, inviteStatus: 'accepted', userId: 'p1' }]
      : [],
    parentUserIds: parentEmail ? ['p1'] : [],
    invitedTeacherIds: [teacherId],
    createdAt: now(),
    updatedAt: now(),
  });
}

async function seed({ history = 3 } = {}) {
  await db.collection('classes').doc(CLASS_A).set({
    name: 'Grade 3 Qur’an', teacherId: OWNER_A, studentCount: 1, admins: [],
    createdAt: now(), updatedAt: now(),
  });
  await db.collection('classes').doc(CLASS_B).set({
    name: 'Grade 5 Fiqh', teacherId: OWNER_B, studentCount: 0,
    admins: [
      { email: 'co@example.com', userId: CO_B, inviteStatus: 'accepted', inviteSentAt: now() },
      { email: 'pending@example.com', userId: 'pending-b', inviteStatus: 'pending', inviteSentAt: now() },
    ],
    createdAt: now(), updatedAt: now(),
  });

  await student(STUDENT, CLASS_A, OWNER_A, 'Ali', 'Khan', 'parent@example.com');

  for (let i = 0; i < history; i++) {
    await db.collection('homework').doc(`hw-${i}`).set({
      studentId: STUDENT, classId: CLASS_A, teacherId: OWNER_A, title: `HW ${i}`,
      status: 'completed', evaluation: 5, parentUserIds: ['p1'],
      invitedTeacherIds: [OWNER_A], createdAt: now(), updatedAt: now(),
    });
    await db.collection('attendance').doc(`at-${i}`).set({
      studentId: STUDENT, classId: CLASS_A, teacherId: OWNER_A, status: 'present',
      date: now(), parentUserIds: ['p1'],
      invitedTeacherIds: [OWNER_A], createdAt: now(), updatedAt: now(),
    });
  }

  // A record belonging to a different student, which must never be touched.
  await student('student-2', CLASS_A, OWNER_A, 'Zayd', 'Omar', 'other@example.com');
  await db.collection('homework').doc('hw-other').set({
    studentId: 'student-2', classId: CLASS_A, teacherId: OWNER_A, title: 'Theirs',
    status: 'assigned', invitedTeacherIds: [OWNER_A], createdAt: now(), updatedAt: now(),
  });
  await db.collection('classes').doc(CLASS_A).update({ studentCount: 2 });
}

const transfer = (overrides = {}) =>
  transferStudentToClass(db, { studentId: STUDENT, toClassId: CLASS_B, actor: ACTOR, ...overrides });

const docsIn = async (collection: string, classId: string) =>
  (await db.collection(collection).where('classId', '==', classId).get()).size;

beforeAll(async () => {
  await clearFirestore();
});

beforeEach(async () => {
  await clearFirestore();
  await seed();
});

describe('transferStudentToClass', () => {
  it('moves the student and every one of their records', async () => {
    const result = await transfer();

    expect(result.moved).toEqual({ homework: 3, attendance: 3 });
    expect(await docsIn('homework', CLASS_B)).toBe(3);
    expect(await docsIn('attendance', CLASS_B)).toBe(3);

    const moved = (await db.collection('students').doc(STUDENT).get()).data()!;
    expect(moved.classId).toBe(CLASS_B);
  });

  it('gives the receiving class its access, and takes the old class off', async () => {
    await transfer();

    const hw = (await db.collection('homework').doc('hw-0').get()).data()!;
    // Owner plus the accepted co-teacher; the pending one gets nothing.
    expect(hw.invitedTeacherIds.sort()).toEqual([CO_B, OWNER_B].sort());
    expect(hw.invitedTeacherIds).not.toContain(OWNER_A);
    // teacherId is the record's owner, which is now the receiving teacher —
    // without this the app's owner-path queries would not return it.
    expect(hw.teacherId).toBe(OWNER_B);
  });

  it('leaves the parent link untouched, so invites keep working', async () => {
    await transfer();
    const hw = (await db.collection('homework').doc('hw-0').get()).data()!;
    const moved = (await db.collection('students').doc(STUDENT).get()).data()!;
    expect(hw.parentUserIds).toEqual(['p1']);
    expect(moved.parentUserIds).toEqual(['p1']);
    expect(moved.parents[0].email).toBe('parent@example.com');
  });

  it('never touches another student’s records', async () => {
    await transfer();
    const other = (await db.collection('homework').doc('hw-other').get()).data()!;
    expect(other.classId).toBe(CLASS_A);
    expect(other.teacherId).toBe(OWNER_A);
  });

  it('corrects both student counts', async () => {
    await transfer();
    expect((await db.collection('classes').doc(CLASS_A).get()).data()!.studentCount).toBe(1);
    expect((await db.collection('classes').doc(CLASS_B).get()).data()!.studentCount).toBe(1);
  });

  it('repairs a drifted count rather than preserving the error', async () => {
    await db.collection('classes').doc(CLASS_A).update({ studentCount: 99 });
    await transfer();
    // Derived from a real count, not 99 - 1.
    expect((await db.collection('classes').doc(CLASS_A).get()).data()!.studentCount).toBe(1);
  });

  it('writes an audit entry, the only record the transfer happened', async () => {
    await transfer();
    const log = await db.collection('adminAuditLog').where('action', '==', 'student.transfer').get();
    expect(log.size).toBe(1);
    const entry = log.docs[0].data();
    expect(entry.actorEmail).toBe(ACTOR.email);
    expect(entry.fromClassId).toBe(CLASS_A);
    expect(entry.toClassId).toBe(CLASS_B);
    expect(entry.studentName).toBe('Ali Khan');
  });

  it('adds no fields the mobile app does not know about', async () => {
    await transfer();
    const moved = (await db.collection('students').doc(STUDENT).get()).data()!;
    const allowed = new Set([
      'firstName', 'lastName', 'classId', 'teacherId', 'parents', 'parentUserIds',
      'invitedTeacherIds', 'surahAyahMode', 'createdAt', 'updatedAt',
    ]);
    expect(Object.keys(moved).filter((k) => !allowed.has(k))).toEqual([]);
  });
});

describe('re-running an interrupted transfer', () => {
  it('completes when the history moved but the student did not', async () => {
    // Exactly the state an interrupted run leaves: history re-pointed first,
    // student doc not yet moved.
    const batch = db.batch();
    for (let i = 0; i < 3; i++) {
      batch.update(db.collection('homework').doc(`hw-${i}`), {
        classId: CLASS_B, teacherId: OWNER_B, invitedTeacherIds: [OWNER_B, CO_B],
      });
    }
    await batch.commit();

    const result = await transfer();

    expect(result.moved.homework).toBe(3);
    expect((await db.collection('students').doc(STUDENT).get()).data()!.classId).toBe(CLASS_B);
    expect(await docsIn('homework', CLASS_B)).toBe(3);
    expect((await db.collection('classes').doc(CLASS_A).get()).data()!.studentCount).toBe(1);
  });

  it('refuses a genuine repeat, so counts cannot be double-adjusted', async () => {
    await transfer();
    await expect(transfer()).rejects.toThrow(/already in/);
    expect((await db.collection('classes').doc(CLASS_B).get()).data()!.studentCount).toBe(1);
    expect((await db.collection('classes').doc(CLASS_A).get()).data()!.studentCount).toBe(1);
  });
});

describe('the duplicate guard', () => {
  it('blocks when the same child already has a record in the target class', async () => {
    await student('dupe', CLASS_B, OWNER_B, 'Ali', 'Khan', 'parent@example.com');

    const error = await transfer().catch((e) => e);
    expect(error).toBeInstanceOf(TransferStudentError);
    expect(error.blockers).toHaveLength(1);
    expect(error.blockers[0].kind).toBe('duplicate-in-target');

    // Nothing moved.
    expect((await db.collection('students').doc(STUDENT).get()).data()!.classId).toBe(CLASS_A);
    expect(await docsIn('homework', CLASS_B)).toBe(0);
  });

  it('cannot be acknowledged past', async () => {
    await student('dupe', CLASS_B, OWNER_B, 'Ali', 'Khan', 'parent@example.com');
    await expect(transfer({ acknowledge: true })).rejects.toThrow(/duplicate/);
    expect((await db.collection('students').doc(STUDENT).get()).data()!.classId).toBe(CLASS_A);
  });

  it('matches names despite case and spacing', async () => {
    await student('dupe', CLASS_B, OWNER_B, '  ALI ', 'khan', 'parent@example.com');
    const error = await transfer().catch((e) => e);
    expect(error.blockers[0].kind).toBe('duplicate-in-target');
  });

  it('only warns when the name matches but no parent does', async () => {
    await student('namesake', CLASS_B, OWNER_B, 'Ali', 'Khan', 'different@example.com');

    const error = await transfer().catch((e) => e);
    expect(error.blockers).toHaveLength(0);
    expect(error.warnings[0].kind).toBe('same-name-in-target');

    // And acknowledging lets it through.
    const result = await transfer({ acknowledge: true });
    expect(result.acknowledged).toHaveLength(1);
    expect((await db.collection('students').doc(STUDENT).get()).data()!.classId).toBe(CLASS_B);
  });

  it('warns about another record for the same child elsewhere', async () => {
    await db.collection('classes').doc('class-c').set({
      name: 'Elsewhere', teacherId: 'owner-c', studentCount: 1, admins: [],
      createdAt: now(), updatedAt: now(),
    });
    await student('elsewhere', 'class-c', 'owner-c', 'Ali', 'Khan', 'parent@example.com');

    const error = await transfer().catch((e) => e);
    expect(error.warnings.map((w: { kind: string }) => w.kind)).toContain('other-record-elsewhere');
  });

  it('does not mistake siblings for duplicates', async () => {
    // Same parent, different child — the common case, and the one a naive
    // parent-email check would wrongly block.
    await student('sibling', CLASS_B, OWNER_B, 'Fatima', 'Khan', 'parent@example.com');
    const result = await transfer();
    expect(result.acknowledged).toHaveLength(0);
    expect((await db.collection('students').doc(STUDENT).get()).data()!.classId).toBe(CLASS_B);
  });

  it('records acknowledged warnings in the audit log', async () => {
    await student('namesake', CLASS_B, OWNER_B, 'Ali', 'Khan', 'different@example.com');
    await transfer({ acknowledge: true });
    const log = await db.collection('adminAuditLog').where('action', '==', 'student.transfer').get();
    expect(log.docs[0].data().acknowledged).toHaveLength(1);
  });
});

describe('validation', () => {
  it('rejects a student that does not exist', async () => {
    await expect(
      transferStudentToClass(db, { studentId: 'nope', toClassId: CLASS_B, actor: ACTOR })
    ).rejects.toThrow(/not found/);
  });

  it('rejects a class that does not exist', async () => {
    await expect(transfer({ toClassId: 'nope' })).rejects.toThrow(/not found/);
  });

  it('rejects a move to the class the student is already in', async () => {
    await expect(transfer({ toClassId: CLASS_A })).rejects.toThrow(/already in/);
  });
});
