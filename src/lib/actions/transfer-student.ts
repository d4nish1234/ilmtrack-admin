import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { Class, Parent, Student } from '@/types';

/**
 * Move a student to another class, taking their history with them.
 *
 * "Taking their history" is the whole point: every homework and attendance
 * record for this student is re-pointed at the new class, so the receiving
 * teacher sees the full record and the child's file stays whole. The cost is
 * that the old class's past reports no longer include them — a report run for
 * last term will differ from what it showed before the transfer. That is the
 * school's decision, recorded here so nobody rediscovers it by surprise.
 *
 * There is no transfer in the mobile app to mirror. Its
 * linkExistingStudentToClass() *copies* the student into a second document
 * with a new id, leaving history behind and the parent links pointing at the
 * old record. Moving is better on every count, not least because onInviteAccepted
 * backfills by studentId alone — so a parent invite accepted after a move
 * still lands correctly, which it would not after a copy.
 *
 * Three properties worth preserving if you change this:
 *
 *  1. **Re-runnable.** Every write sets an absolute target value rather than
 *     mutating relative to what is there, and the history rewrite happens
 *     *before* the student doc moves. So an interrupted run leaves a state
 *     that simply running it again completes. Were the student moved first,
 *     a second run would bounce off the "already in that class" check with
 *     half the history stranded.
 *  2. **Counted exactly once.** studentCount is the one thing that cannot be
 *     made idempotent by repetition, so the move and both counts happen in a
 *     single transaction, and the counts are derived from a real count rather
 *     than incremented blindly — which also repairs any pre-existing drift.
 *  3. **No new fields.** Everything about the transfer lives in adminAuditLog,
 *     so the documents stay byte-identical to what the app and its Cloud
 *     Functions expect.
 *
 * No Firestore trigger watches `students`, so none of this fires a Cloud
 * Function. Updating classes/{id}.studentCount does wake onTeacherRemoved,
 * which returns immediately because no admin changed.
 *
 * The db is injected rather than imported so tests can drive it against the
 * Firestore emulator.
 */

/** Firestore allows 500 writes per batch; leave headroom. */
const BATCH_LIMIT = 450;

/** Collections keyed by studentId that carry the class denormalization. */
const HISTORY_COLLECTIONS = ['homework', 'attendance'] as const;

export interface TransferStudentInput {
  studentId: string;
  toClassId: string;
  /** Who performed this, for the audit log. */
  actor: { uid: string; email: string };
  /** Proceed despite warnings. Blockers are never overridable. */
  acknowledge?: boolean;
}

export type FindingKind =
  | 'duplicate-in-target'
  | 'same-name-in-target'
  | 'other-record-elsewhere';

export interface Finding {
  kind: FindingKind;
  message: string;
}

export interface TransferStudentResult {
  studentId: string;
  studentName: string;
  fromClassId: string;
  fromClassName: string;
  toClassId: string;
  toClassName: string;
  /** History documents re-pointed, per collection. */
  moved: Record<string, number>;
  studentCounts: { from: number; to: number };
  /** Warnings the caller acknowledged, echoed into the result and the log. */
  acknowledged: Finding[];
}

/** A failure the operator caused and can fix — surfaced as a 400, not a 500. */
export class TransferStudentError extends Error {
  constructor(
    message: string,
    readonly blockers: Finding[] = [],
    readonly warnings: Finding[] = []
  ) {
    super(message);
  }
}

const norm = (value: string | undefined) =>
  (value || '').trim().toLowerCase().replace(/\s+/g, ' ');

const nameKey = (s: Pick<Student, 'firstName' | 'lastName'>) =>
  `${norm(s.firstName)}|${norm(s.lastName)}`;

const fullName = (s: Pick<Student, 'firstName' | 'lastName'>) =>
  `${s.firstName ?? ''} ${s.lastName ?? ''}`.trim() || '(no name)';

const parentEmails = (s: { parents?: Parent[] }) =>
  new Set((s.parents || []).map((p) => norm(p?.email)).filter(Boolean));

/**
 * Shared parent email alone means *siblings*, which is ordinary — most
 * families have more than one child enrolled. Only a shared parent together
 * with the same name suggests one child recorded twice.
 */
function sharesParent(a: { parents?: Parent[] }, b: { parents?: Parent[] }): boolean {
  const emails = parentEmails(b);
  return [...parentEmails(a)].some((email) => emails.has(email));
}

/** Owner plus accepted co-teachers — mirrors getInvitedTeacherIds() in the app. */
function invitedTeacherIdsFor(cls: Class): string[] {
  const ids = [cls.teacherId];
  for (const admin of cls.admins || []) {
    if (admin.userId && admin.inviteStatus === 'accepted') ids.push(admin.userId);
  }
  return [...new Set(ids.filter(Boolean))];
}

/**
 * Look for the same child already existing as another record.
 *
 * The target class is checked thoroughly — every name normalized — because
 * that is where a blocker can arise and the set is small. Records elsewhere
 * are found with an exact-match query on first and last name, which is two
 * equality filters and so needs no composite index. That is cheaper than
 * scanning the collection and can miss an odd capitalization, which is an
 * acceptable trade for something that only ever raises a warning.
 */
async function findDuplicates(
  db: Firestore,
  student: Student,
  studentId: string,
  toClassId: string
): Promise<{ blockers: Finding[]; warnings: Finding[] }> {
  const blockers: Finding[] = [];
  const warnings: Finding[] = [];

  const inTarget = await db.collection('students').where('classId', '==', toClassId).get();
  for (const doc of inTarget.docs) {
    if (doc.id === studentId) continue;
    const other = { ...(doc.data() as Student), id: doc.id };
    if (nameKey(other) !== nameKey(student)) continue;

    if (sharesParent(other, student)) {
      blockers.push({
        kind: 'duplicate-in-target',
        message:
          `${fullName(student)} already has a record in that class (${doc.id}) ` +
          'sharing a parent email. Transferring would leave the same child ' +
          'enrolled twice, each half with its own history. Resolve that record first.',
      });
    } else {
      warnings.push({
        kind: 'same-name-in-target',
        message:
          `That class already has a ${fullName(student)} (${doc.id}), but with no ` +
          'parent in common — so probably a different child. Worth a look.',
      });
    }
  }

  const sameName = await db
    .collection('students')
    .where('firstName', '==', student.firstName)
    .where('lastName', '==', student.lastName)
    .get();

  for (const doc of sameName.docs) {
    if (doc.id === studentId) continue;
    const other = { ...(doc.data() as Student), id: doc.id };
    if (other.classId === toClassId) continue; // already reported above
    if (!sharesParent(other, student)) continue;

    warnings.push({
      kind: 'other-record-elsewhere',
      message:
        `${fullName(student)} also has a record in class ${other.classId} (${doc.id}) ` +
        'sharing a parent email — likely the same child added twice in the app. ' +
        'Transferring this one leaves that one where it is.',
    });
  }

  return { blockers, warnings };
}

export async function transferStudentToClass(
  db: Firestore,
  { studentId, toClassId, actor, acknowledge = false }: TransferStudentInput
): Promise<TransferStudentResult> {
  // ── 1. Load and validate ────────────────────────────────────────────────
  const studentRef = db.collection('students').doc(studentId);
  const toClassRef = db.collection('classes').doc(toClassId);
  const [studentSnap, toClassSnap] = await Promise.all([studentRef.get(), toClassRef.get()]);

  if (!studentSnap.exists) throw new TransferStudentError(`Student ${studentId} not found.`);
  if (!toClassSnap.exists) throw new TransferStudentError(`Class ${toClassId} not found.`);

  const student = { ...(studentSnap.data() as Student), id: studentId };
  const toClass = { ...(toClassSnap.data() as Class), id: toClassId };
  const fromClassId = student.classId;

  if (fromClassId === toClassId) {
    throw new TransferStudentError(`${fullName(student)} is already in ${toClass.name}.`);
  }

  const fromClassRef = db.collection('classes').doc(fromClassId);
  const fromClassSnap = await fromClassRef.get();
  const fromClassName = (fromClassSnap.data() as Class | undefined)?.name ?? '(deleted class)';

  // ── 2. Duplicate guard ──────────────────────────────────────────────────
  const { blockers, warnings } = await findDuplicates(db, student, studentId, toClassId);

  if (blockers.length > 0) {
    throw new TransferStudentError(
      'This transfer would create a duplicate record.',
      blockers,
      warnings
    );
  }
  if (warnings.length > 0 && !acknowledge) {
    throw new TransferStudentError(
      'This transfer needs confirming before it runs.',
      [],
      warnings
    );
  }

  // The access list the receiving class implies: its owner and accepted
  // co-teachers. Set outright, so the old class's teachers drop off.
  const invitedTeacherIds = invitedTeacherIdsFor(toClass);
  const placement = {
    classId: toClassId,
    teacherId: toClass.teacherId,
    invitedTeacherIds,
  };

  // ── 3. Re-point the history, before the student moves ───────────────────
  // Queried by studentId, so this catches every record wherever it currently
  // sits — including any left behind by an interrupted earlier run.
  const moved: Record<string, number> = {};
  for (const collection of HISTORY_COLLECTIONS) {
    const snap = await db.collection(collection).where('studentId', '==', studentId).get();
    moved[collection] = snap.size;

    for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      for (const doc of snap.docs.slice(i, i + BATCH_LIMIT)) {
        batch.update(doc.ref, { ...placement, updatedAt: FieldValue.serverTimestamp() });
      }
      await batch.commit();
    }
  }

  // ── 4. Move the student and fix both counts, exactly once ───────────────
  const studentCounts = await db.runTransaction(async (tx) => {
    const fresh = await tx.get(studentRef);
    const current = fresh.data() as Student | undefined;
    if (!current) throw new TransferStudentError(`Student ${studentId} disappeared mid-transfer.`);
    if (current.classId === toClassId) {
      // A concurrent run already moved them; leave the counts to that run.
      throw new TransferStudentError(`${fullName(student)} is already in ${toClass.name}.`);
    }

    // Counts read inside the transaction still reflect the pre-move state,
    // hence the ±1. Deriving them from a real count rather than incrementing
    // blindly means any existing drift is corrected here too.
    const [fromStudents, toStudents] = await Promise.all([
      tx.get(db.collection('students').where('classId', '==', fromClassId)),
      tx.get(db.collection('students').where('classId', '==', toClassId)),
    ]);

    const from = Math.max(0, fromStudents.size - 1);
    const to = toStudents.size + 1;

    tx.update(studentRef, { ...placement, updatedAt: FieldValue.serverTimestamp() });
    if (fromClassSnap.exists) {
      tx.update(fromClassRef, { studentCount: from, updatedAt: FieldValue.serverTimestamp() });
    }
    tx.update(toClassRef, { studentCount: to, updatedAt: FieldValue.serverTimestamp() });

    return { from, to };
  });

  // ── 5. Audit trail — the only record that this transfer happened ────────
  // Also where a report would look to find when the student joined, which is
  // why no enrolledAt field is stamped on the documents themselves.
  await db.collection('adminAuditLog').add({
    action: 'student.transfer',
    actorUid: actor.uid,
    actorEmail: actor.email,
    studentId,
    studentName: fullName(student),
    fromClassId,
    fromClassName,
    toClassId,
    toClassName: toClass.name,
    moved,
    acknowledged: warnings,
    createdAt: FieldValue.serverTimestamp(),
  });

  return {
    studentId,
    studentName: fullName(student),
    fromClassId,
    fromClassName,
    toClassId,
    toClassName: toClass.name,
    moved,
    studentCounts,
    acknowledged: warnings,
  };
}
