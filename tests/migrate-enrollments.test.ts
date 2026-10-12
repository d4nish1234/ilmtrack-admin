/**
 * Phase 1 of the student-identity migration, exercised end to end.
 *
 *   cd ../ilmTrack && firebase emulators:start --only firestore
 *   cd ../ilmTrack-admin && npm test
 *
 * This is the script that runs against production on migration day, so what is
 * asserted here is as much about what it does *not* do — nothing deleted, no
 * sibling merged, no second run doubling anything — as what it does.
 *
 * The script reads its configuration from argv and env at import time, so each
 * case runs it as a child process rather than importing it, which is also how
 * it will actually be run.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'ilmtrack-admin-test';
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIRESTORE_EMULATOR_HOST = EMULATOR;

const app = initializeApp({ projectId: PROJECT_ID }, `migrate-test-${Date.now()}`);
const db: Firestore = getFirestore(app);

/** Runs the real script against the emulator, as migration day will. */
function runScript(...args: string[]): string {
  return execFileSync('npx', ['tsx', 'scripts/migrate-enrollments.ts', ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      FIRESTORE_EMULATOR_HOST: EMULATOR,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT_ID,
      // No credential: the script takes its emulator branch, exactly as a
      // rehearsal run would.
      FIREBASE_USE_EMULATOR: 'true',
    },
  });
}

async function clear() {
  await fetch(
    `http://${EMULATOR}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' }
  );
}

const now = () => Timestamp.now();

async function student(
  id: string,
  firstName: string,
  lastName: string,
  classId: string,
  parentEmails: string[]
) {
  await db.collection('students').doc(id).set({
    firstName, lastName, classId, teacherId: 'owner',
    parents: parentEmails.map((email) => ({ email, inviteStatus: 'accepted' })),
    parentUserIds: [], invitedTeacherIds: ['owner'],
    createdAt: now(), updatedAt: now(),
  });
}

async function record(col: string, id: string, studentId: string, classId: string) {
  await db.collection(col).doc(id).set({
    studentId, classId, teacherId: 'owner',
    parentUserIds: [], invitedTeacherIds: ['owner'],
    createdAt: now(), updatedAt: now(),
  });
}

const enrollments = async () => (await db.collection('enrollments').get()).docs.map((d) => d.id);
const studentDoc = async (id: string) => (await db.collection('students').doc(id).get()).data();
const recordDoc = async (col: string, id: string) =>
  (await db.collection(col).doc(id).get()).data();

beforeAll(clear);
beforeEach(clear);
afterAll(async () => { await deleteApp(app); });

describe('migrate-enrollments (phase 1)', () => {
  it('creates one enrolment per student, and is idempotent', async () => {
    await student('s1', 'Ali', 'Ahmad', 'class-a', ['p1@example.com']);
    await student('s2', 'Isa', 'Malik', 'class-b', ['p2@example.com']);

    runScript();
    expect((await enrollments()).sort()).toEqual(['s1_class-a', 's2_class-b']);

    // The id is derived from student+class, so a second run cannot double up.
    runScript();
    expect(await enrollments()).toHaveLength(2);
  });

  it('merges the same person recorded in two classes', async () => {
    await student('keep', 'Asiya', 'Iftikhar', 'class-a', ['mum@example.com']);
    await student('dupe', 'Asiya', 'Iftikhar', 'class-b', ['mum@example.com']);
    await record('homework', 'hw1', 'keep', 'class-a');
    await record('homework', 'hw2', 'keep', 'class-a');
    await record('attendance', 'att1', 'dupe', 'class-b');

    runScript();

    // The keeper is whichever already holds more records — fewest re-points.
    expect((await recordDoc('attendance', 'att1'))!.studentId).toBe('keep');
    expect((await recordDoc('attendance', 'att1'))!.migratedFromStudentId).toBe('dupe');
    // Both classes still contain this person, via two enrolments on one id.
    expect((await enrollments()).sort()).toEqual(['dupe_class-b', 'keep_class-a', 'keep_class-b']);
  });

  it('marks the merged-away student but NEVER deletes it', async () => {
    await student('keep', 'Asiya', 'Iftikhar', 'class-a', ['mum@example.com']);
    await student('dupe', 'Asiya', 'Iftikhar', 'class-b', ['mum@example.com']);
    await record('homework', 'hw1', 'keep', 'class-a');

    runScript();

    const dupe = await studentDoc('dupe');
    expect(dupe).toBeDefined();
    expect(dupe!.mergedIntoStudentId).toBe('keep');
    // Phase 1 adds only: every original field survives.
    expect(dupe!.classId).toBe('class-b');
    expect(dupe!.invitedTeacherIds).toEqual(['owner']);
  });

  it('does NOT merge siblings — a shared parent email is not enough', async () => {
    // Most families here have several children enrolled, so this is the
    // common case, not the edge case.
    await student('s1', 'Hamza', 'Mahboob', 'class-a', ['dad@example.com']);
    await student('s2', 'Enayah', 'Mahboob', 'class-a', ['dad@example.com']);

    runScript();

    expect(await studentDoc('s1')).not.toHaveProperty('mergedIntoStudentId');
    expect(await studentDoc('s2')).not.toHaveProperty('mergedIntoStudentId');
  });

  it('does NOT merge two people who share a name but no parent', async () => {
    await student('s1', 'Ali', 'Ahmad', 'class-a', ['one@example.com']);
    await student('s2', 'Ali', 'Ahmad', 'class-b', ['two@example.com']);

    runScript();

    expect(await studentDoc('s1')).not.toHaveProperty('mergedIntoStudentId');
    expect(await studentDoc('s2')).not.toHaveProperty('mergedIntoStudentId');
  });

  it('--check writes nothing', async () => {
    await student('s1', 'Ali', 'Ahmad', 'class-a', ['p1@example.com']);
    try {
      runScript('--check'); // exits 1 while work remains
    } catch {
      /* expected */
    }
    expect(await enrollments()).toEqual([]);
  });

  it('--undo puts everything back exactly', async () => {
    await student('keep', 'Asiya', 'Iftikhar', 'class-a', ['mum@example.com']);
    await student('dupe', 'Asiya', 'Iftikhar', 'class-b', ['mum@example.com']);
    await record('homework', 'hw1', 'keep', 'class-a');
    await record('attendance', 'att1', 'dupe', 'class-b');

    runScript();
    runScript('--undo');

    expect(await enrollments()).toEqual([]);
    expect((await recordDoc('attendance', 'att1'))!.studentId).toBe('dupe');
    expect(await recordDoc('attendance', 'att1')).not.toHaveProperty('migratedFromStudentId');
    expect(await studentDoc('dupe')).not.toHaveProperty('mergedIntoStudentId');
  });

  it('skips a student with no class rather than writing a broken enrolment', async () => {
    await db.collection('students').doc('orphan').set({
      firstName: 'No', lastName: 'Class', teacherId: 'owner',
      parents: [], parentUserIds: [], invitedTeacherIds: [],
      createdAt: now(), updatedAt: now(),
    });

    runScript();
    expect(await enrollments()).toEqual([]);
  });
});
