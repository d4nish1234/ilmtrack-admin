/**
 * Phase 1 of the student-identity migration: give every student one document
 * and move class membership into `enrollments`.
 *
 *   npm run migrate:enrollments -- --check    # report the plan, write nothing
 *   npm run migrate:enrollments               # apply
 *   npm run migrate:enrollments -- --undo     # reverse it
 *
 * **This phase only ever adds.** No field is deleted and no document is
 * removed, so a mistake here is undone by deleting what was added rather than
 * by restoring a backup. Stripping `classId` and `invitedTeacherIds`, and
 * deleting the merged-away document, happen in a separate pass days later,
 * once the new read path has been proven. See ../ilmTrack/todo.md step 4.
 *
 * Two things happen:
 *
 *  1. **Enrolments.** One `enrollments/{studentId}_{classId}` per student
 *     document. The id is derived rather than random so re-running cannot
 *     create a second copy.
 *
 *  2. **Merges.** Where one person has a document in each of two classes, the
 *     records are re-pointed onto a single keeper. Each moved record records
 *     the id it came from, and the merged-away document is *marked*, never
 *     deleted, so --undo can put everything back exactly.
 *
 * A duplicate is the same name *and* a shared parent email. A shared email
 * alone means siblings — most families here have several children enrolled.
 */
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { Student } from '@/types';

config({ path: '.env.local' });
config({ path: '.env' });

// Emulator-aware, like scripts/grant-admin.ts — so this can be rehearsed
// against a local copy before it is pointed at production, which for a
// migration is the whole point.
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (process.env.FIREBASE_USE_EMULATOR === 'true') {
  process.env.FIRESTORE_EMULATOR_HOST ||=
    `${process.env.FIREBASE_EMULATOR_HOST || '127.0.0.1'}:8080`;
  initializeApp({ projectId: projectId || 'ilmtrack-admin-local' });
} else {
  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!keyPath) {
    console.error('FIREBASE_SERVICE_ACCOUNT_PATH is not set. See .env.example.');
    process.exit(1);
  }
  initializeApp({
    credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))),
    projectId,
  });
}

const args = process.argv.slice(2).filter((a) => a !== '--');
const checkOnly = args.includes('--check');
const undo = args.includes('--undo');

/** Firestore allows 500 writes per batch; leave headroom. */
const BATCH_LIMIT = 450;
const RECORD_COLLECTIONS = ['homework', 'attendance'] as const;

type StudentDoc = Student & { id: string; mergedIntoStudentId?: string };

const enrollmentId = (studentId: string, classId: string) => `${studentId}_${classId}`;
const nameKey = (s: Pick<Student, 'firstName' | 'lastName'>) =>
  `${(s.firstName || '').trim().toLowerCase()} ${(s.lastName || '').trim().toLowerCase()}`;
const parentEmails = (s: Student) =>
  new Set((s.parents || []).map((p) => (p.email || '').toLowerCase()).filter(Boolean));

/** Same person recorded twice: same name AND a shared parent email. */
function findDuplicates(students: StudentDoc[]): StudentDoc[][] {
  const byName = new Map<string, StudentDoc[]>();
  for (const s of students) {
    const key = nameKey(s);
    byName.set(key, [...(byName.get(key) || []), s]);
  }

  const groups: StudentDoc[][] = [];
  for (const list of byName.values()) {
    if (list.length < 2) continue;
    const shares = list.some((a, i) =>
      list.some((b, j) => {
        if (i >= j) return false;
        const [ea, eb] = [parentEmails(a), parentEmails(b)];
        return [...ea].some((e) => eb.has(e));
      })
    );
    if (shares) groups.push(list);
  }
  return groups;
}

async function commitInChunks(
  db: Firestore,
  writes: Array<(batch: FirebaseFirestore.WriteBatch) => void>
): Promise<void> {
  for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const write of writes.slice(i, i + BATCH_LIMIT)) write(batch);
    await batch.commit();
  }
}

async function main() {
  const db = getFirestore();
  const [studentsSnap, classesSnap] = await Promise.all([
    db.collection('students').get(),
    db.collection('classes').get(),
  ]);
  const className = new Map(classesSnap.docs.map((c) => [c.id, c.data().name as string]));
  const students: StudentDoc[] = studentsSnap.docs.map((d) => ({
    ...(d.data() as Student),
    id: d.id,
  }));

  if (undo) return runUndo(db, students);

  // ── Plan ────────────────────────────────────────────────────────────────
  const existing = await db.collection('enrollments').get();
  const haveEnrollment = new Set(existing.docs.map((d) => d.id));

  const toCreate = students
    .filter((s) => s.classId && !haveEnrollment.has(enrollmentId(s.id, s.classId)))
    .map((s) => ({ student: s, classId: s.classId! }));

  const groups = findDuplicates(students.filter((s) => !s.mergedIntoStudentId));
  const merges: Array<{ keeper: StudentDoc; losers: StudentDoc[]; records: number }> = [];

  for (const group of groups) {
    // The keeper is whichever document already holds the most records: fewest
    // re-points, least churn, and deterministic given the same data.
    const counted = await Promise.all(
      group.map(async (s) => {
        let n = 0;
        for (const col of RECORD_COLLECTIONS) {
          n += (await db.collection(col).where('studentId', '==', s.id).get()).size;
        }
        return { student: s, n };
      })
    );
    counted.sort((a, b) => b.n - a.n || a.student.id.localeCompare(b.student.id));
    const [keeper, ...losers] = counted;
    merges.push({
      keeper: keeper.student,
      losers: losers.map((l) => l.student),
      records: losers.reduce((sum, l) => sum + l.n, 0),
    });
  }

  console.log(`students: ${students.length}`);
  console.log(`enrolments to create: ${toCreate.length} (${haveEnrollment.size} already exist)`);
  console.log(`people recorded twice: ${merges.length}`);
  for (const m of merges) {
    console.log(`   "${m.keeper.firstName} ${m.keeper.lastName}"`);
    console.log(`      keep  ${m.keeper.id}  (${className.get(m.keeper.classId!) ?? '?'})`);
    for (const l of m.losers) {
      console.log(`      merge ${l.id}  (${className.get(l.classId!) ?? '?'})`);
    }
    console.log(`      ${m.records} record(s) to re-point`);
  }

  if (checkOnly) {
    const remaining = toCreate.length + merges.length;
    console.log(
      remaining === 0
        ? '\nNothing to do — phase 1 is complete.'
        : '\nRun without --check to apply. Nothing is deleted.'
    );
    process.exit(remaining === 0 ? 0 : 1);
  }

  // ── Apply ───────────────────────────────────────────────────────────────
  const writes: Array<(b: FirebaseFirestore.WriteBatch) => void> = [];

  for (const { student, classId } of toCreate) {
    const ref = db.collection('enrollments').doc(enrollmentId(student.id, classId));
    writes.push((b) =>
      b.set(ref, {
        studentId: student.id,
        classId,
        active: true,
        // The student document's own creation is the best record we have of
        // when they joined; there is nothing more accurate to recover.
        joinedAt: student.createdAt ?? FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        migratedAt: FieldValue.serverTimestamp(),
      })
    );
  }
  await commitInChunks(db, writes);
  console.log(`\ncreated ${writes.length} enrolment(s)`);

  for (const m of merges) {
    const moves: Array<(b: FirebaseFirestore.WriteBatch) => void> = [];

    for (const loser of m.losers) {
      for (const col of RECORD_COLLECTIONS) {
        const snap = await db.collection(col).where('studentId', '==', loser.id).get();
        for (const doc of snap.docs) {
          moves.push((b) =>
            b.update(doc.ref, {
              studentId: m.keeper.id,
              // Recorded so --undo can put it back exactly.
              migratedFromStudentId: loser.id,
            })
          );
        }
      }

      // The loser keeps its own enrolment, now pointing at the keeper, so the
      // other teacher's class still contains this person.
      if (loser.classId) {
        const ref = db.collection('enrollments').doc(enrollmentId(m.keeper.id, loser.classId));
        moves.push((b) =>
          b.set(ref, {
            studentId: m.keeper.id,
            classId: loser.classId,
            active: true,
            joinedAt: loser.createdAt ?? FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            migratedAt: FieldValue.serverTimestamp(),
          })
        );
      }

      // Marked, never deleted — phase 4 removes it once this is proven.
      moves.push((b) =>
        b.update(db.collection('students').doc(loser.id), {
          mergedIntoStudentId: m.keeper.id,
          mergedAt: FieldValue.serverTimestamp(),
        })
      );
    }

    await commitInChunks(db, moves);
    console.log(`merged "${m.keeper.firstName} ${m.keeper.lastName}": ${moves.length} write(s)`);
  }

  console.log('\nDone. Nothing was deleted. Re-run with --check to verify.');
  process.exit(0);
}

/** Reverses everything the apply pass wrote. */
async function runUndo(db: Firestore, students: StudentDoc[]) {
  const merged = students.filter((s) => s.mergedIntoStudentId);
  const writes: Array<(b: FirebaseFirestore.WriteBatch) => void> = [];

  for (const loser of merged) {
    for (const col of RECORD_COLLECTIONS) {
      const snap = await db
        .collection(col)
        .where('migratedFromStudentId', '==', loser.id)
        .get();
      for (const doc of snap.docs) {
        writes.push((b) =>
          b.update(doc.ref, {
            studentId: loser.id,
            migratedFromStudentId: FieldValue.delete(),
          })
        );
      }
    }
    writes.push((b) =>
      b.update(db.collection('students').doc(loser.id), {
        mergedIntoStudentId: FieldValue.delete(),
        mergedAt: FieldValue.delete(),
      })
    );
  }

  const enrollments = await db.collection('enrollments').get();
  for (const doc of enrollments.docs) {
    if (doc.data().migratedAt) writes.push((b) => b.delete(doc.ref));
  }

  if (checkOnly) {
    console.log(`would reverse ${merged.length} merge(s) and delete ${enrollments.size} enrolment(s)`);
    process.exit(0);
  }

  await commitInChunks(db, writes);
  console.log(`reversed: ${writes.length} write(s). Back to the pre-migration shape.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
