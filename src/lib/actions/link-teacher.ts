import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { Admin, Class, User } from '@/types';

/**
 * Link a registered teacher to a class as a co-teacher.
 *
 * Mirrors addAdmin() in ../ilmTrack/src/services/class.service.ts (the
 * "user already exists" branch), which is the shape the mobile app and the
 * Cloud Functions already expect. Two deliberate differences:
 *
 *  1. The backfill in step 4 filters on `classId` only. The app additionally
 *     filters `teacherId == owner` purely to satisfy client-side security
 *     rules, which silently misses docs a co-teacher created. The
 *     onTeacherInviteAccepted Cloud Function filters on classId alone, and
 *     we match the function.
 *  2. Writes are chunked at 450 ops — a busy class can exceed Firestore's
 *     500-per-batch limit, which the app's single batch would hit.
 *
 * The adminInvites doc in step 5 is created with status 'accepted'. That
 * fires sendTeacherInviteEmail (an onDocumentCreated trigger) so the teacher
 * is told which class they were added to, but NOT onTeacherInviteAccepted
 * (an onDocumentUpdated trigger) — which is why we do the backfill ourselves
 * rather than leaving it to the function.
 *
 * The db is injected rather than imported so tests can drive it against the
 * Firestore emulator.
 */

/** Firestore allows 500 writes per batch; leave headroom. */
const BATCH_LIMIT = 450;

/** Collections carrying the denormalized invitedTeacherIds array. */
const DENORMALIZED_COLLECTIONS = ['students', 'homework', 'attendance'] as const;

export interface LinkTeacherInput {
  classId: string;
  teacherUserId: string;
  /** Who performed this, for the audit log. */
  actor: { uid: string; email: string };
}

export interface LinkTeacherResult {
  classId: string;
  className: string;
  teacherUserId: string;
  teacherEmail: string;
  /** Docs touched per collection by the invitedTeacherIds backfill. */
  backfilled: Record<string, number>;
}

/** A failure the operator caused and can fix — surfaced as a 400, not a 500. */
export class LinkTeacherError extends Error {}

export async function linkTeacherToClass(
  db: Firestore,
  { classId, teacherUserId, actor }: LinkTeacherInput
): Promise<LinkTeacherResult> {
  // ── 1. Load and validate ────────────────────────────────────────────────
  const classRef = db.collection('classes').doc(classId);
  const [classSnap, teacherSnap] = await Promise.all([
    classRef.get(),
    db.collection('users').doc(teacherUserId).get(),
  ]);

  if (!classSnap.exists) throw new LinkTeacherError(`Class ${classId} not found.`);
  if (!teacherSnap.exists) throw new LinkTeacherError(`User ${teacherUserId} not found.`);

  const classData = classSnap.data() as Class;
  const teacher = teacherSnap.data() as User;

  if (teacher.role !== 'teacher') {
    throw new LinkTeacherError(
      `${teacher.email} is a ${teacher.role}, not a teacher. Only teachers can co-teach a class.`
    );
  }
  if (classData.teacherId === teacherUserId) {
    throw new LinkTeacherError(`${teacher.email} already owns this class.`);
  }

  const email = teacher.email.toLowerCase();
  const currentAdmins: Admin[] = classData.admins || [];
  if (currentAdmins.some((a) => a.email.toLowerCase() === email)) {
    throw new LinkTeacherError(`${email} is already a co-teacher of this class.`);
  }

  const now = Timestamp.now();

  // ── 2. Append the co-teacher entry on the class ─────────────────────────
  // admins is an array of objects, so arrayUnion can't dedupe it: read,
  // modify, write. The validation above is what guards against duplicates.
  const newAdmin: Admin = {
    email,
    userId: teacherUserId,
    inviteStatus: 'accepted',
    inviteSentAt: now,
    acceptedAt: now,
  };

  await classRef.update({
    admins: [...currentAdmins, newAdmin],
    updatedAt: FieldValue.serverTimestamp(),
  });

  // ── 3. Point the teacher's user doc at the class ────────────────────────
  await teacherSnap.ref.update({
    adminClassIds: FieldValue.arrayUnion(classId),
  });

  // ── 4. Backfill invitedTeacherIds so security rules let them read ───────
  const backfilled: Record<string, number> = {};
  for (const collection of DENORMALIZED_COLLECTIONS) {
    const snap = await db.collection(collection).where('classId', '==', classId).get();
    backfilled[collection] = snap.size;

    for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      for (const doc of snap.docs.slice(i, i + BATCH_LIMIT)) {
        batch.update(doc.ref, {
          invitedTeacherIds: FieldValue.arrayUnion(teacherUserId),
        });
      }
      await batch.commit();
    }
  }

  // ── 5. Invite record — fires the "you've been added to X" email ─────────
  await db.collection('adminInvites').add({
    email,
    classId,
    status: 'accepted',
    userId: teacherUserId,
    createdAt: FieldValue.serverTimestamp(),
  });

  // ── 6. Audit trail (read by nothing; exists so support actions are traceable)
  await db.collection('adminAuditLog').add({
    action: 'class.linkTeacher',
    actorUid: actor.uid,
    actorEmail: actor.email,
    classId,
    className: classData.name,
    targetUserId: teacherUserId,
    targetEmail: email,
    backfilled,
    createdAt: FieldValue.serverTimestamp(),
  });

  return {
    classId,
    className: classData.name,
    teacherUserId,
    teacherEmail: email,
    backfilled,
  };
}
