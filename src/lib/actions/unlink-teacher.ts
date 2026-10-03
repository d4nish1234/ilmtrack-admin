import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import type { Admin, Class } from '@/types';

/**
 * Remove a co-teacher from a class, and with them every grant of access the
 * link created.
 *
 * The inverse of linkTeacherToClass, with three deliberate differences from
 * removeAdmin() in ../ilmTrack/src/services/class.service.ts:
 *
 *  1. **Keyed by email, never uid.** A co-teacher's stored `userId` can point
 *     at a deleted auth account — delete an account and sign up again with the
 *     same address and the uid changes while `admins[].userId` keeps naming the
 *     dead one. Email is the only stable handle, and it is what the app's own
 *     removeAdmin matches on too. This is what makes unlink -> link a repair
 *     for that case; see todo.md #7 in ../ilmTrack.
 *
 *  2. **It strips `invitedTeacherIds` itself**, chunked at 450. The app leaves
 *     that to the onTeacherRemoved trigger, which builds one unchunked batch
 *     and therefore throws past Firestore's 500-write limit — on a large class
 *     removal silently leaves the teacher's access intact. The trigger still
 *     fires here and is harmlessly idempotent; we just do not depend on it.
 *
 *  3. **It writes `adminUserIds` explicitly** rather than waiting for the
 *     syncClassAdminUserIds trigger to recompute it. That field is what
 *     firestore.rules reads to authorize a co-teacher, so leaving a revocation
 *     to land asynchronously would keep access open for the trigger's latency.
 *     Granting can wait for a trigger; revoking should not.
 *
 * Safe to re-run. The denormalized arrays are stripped *before* the admins
 * entry is removed, so an interrupted run leaves the entry in place and a
 * second run finishes the job — the same ordering, and the same reason, as
 * transfer-student.ts. Every write is absolute or an arrayRemove, so repeating
 * one changes nothing.
 */

/** Firestore allows 500 writes per batch; leave headroom. */
const BATCH_LIMIT = 450;

/** Collections carrying the denormalized invitedTeacherIds array. */
const DENORMALIZED_COLLECTIONS = ['students', 'homework', 'attendance'] as const;

export interface UnlinkTeacherInput {
  classId: string;
  /** The co-teacher's email. Not their uid — see note 1 above. */
  teacherEmail: string;
  /** Who performed this, for the audit log. */
  actor: { uid: string; email: string };
}

export interface UnlinkTeacherResult {
  classId: string;
  className: string;
  teacherEmail: string;
  /** The uid whose access was revoked, or null if the entry never had one. */
  removedUserId: string | null;
  /** Docs touched per collection by the invitedTeacherIds strip. */
  stripped: Record<string, number>;
}

/** A failure the operator caused and can fix — surfaced as a 400, not a 500. */
export class UnlinkTeacherError extends Error {}

export async function unlinkTeacherFromClass(
  db: Firestore,
  { classId, teacherEmail, actor }: UnlinkTeacherInput
): Promise<UnlinkTeacherResult> {
  const email = teacherEmail.trim().toLowerCase();
  if (!email) throw new UnlinkTeacherError('No teacher email given.');

  // ── 1. Load and validate ────────────────────────────────────────────────
  const classRef = db.collection('classes').doc(classId);
  const classSnap = await classRef.get();
  if (!classSnap.exists) throw new UnlinkTeacherError(`Class ${classId} not found.`);

  const classData = classSnap.data() as Class;
  const admins: Admin[] = classData.admins || [];
  const entry = admins.find((a) => a.email?.toLowerCase() === email);

  if (!entry) {
    throw new UnlinkTeacherError(`${email} is not a co-teacher of this class.`);
  }

  const remaining = admins.filter((a) => a.email?.toLowerCase() !== email);
  const userId = entry.userId || null;

  // Never revoke the owner. Their access comes from classes.teacherId, so
  // stripping the uid would lock them out of their own class — and an entry
  // naming the owner means the data is already malformed.
  if (userId && userId === classData.teacherId) {
    throw new UnlinkTeacherError(
      `${email} owns this class; unlinking would revoke the owner's own access. ` +
        'Fix the stray co-teacher entry directly instead.'
    );
  }

  // Two admin entries can name the same uid (a duplicate row, or two addresses
  // for one person). Revoking then would cut access the other entry still
  // grants, so only strip when nothing else is holding the uid open.
  const stillGranted = remaining.some((a) => a.userId && a.userId === userId);
  const shouldStrip = Boolean(userId) && !stillGranted;

  // ── 2. Strip invitedTeacherIds first — see the re-runnability note above ─
  const stripped: Record<string, number> = {};
  for (const collection of DENORMALIZED_COLLECTIONS) {
    if (!shouldStrip) {
      stripped[collection] = 0;
      continue;
    }

    // Filtered on classId alone, exactly as linkTeacherToClass's backfill is.
    // Adding `invitedTeacherIds array-contains uid` would narrow the write set
    // but needs a composite index per collection, and arrayRemove on a doc
    // that never held the uid is a no-op anyway.
    const snap = await db.collection(collection).where('classId', '==', classId).get();
    stripped[collection] = snap.size;

    for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      for (const doc of snap.docs.slice(i, i + BATCH_LIMIT)) {
        batch.update(doc.ref, { invitedTeacherIds: FieldValue.arrayRemove(userId) });
      }
      await batch.commit();
    }
  }

  // ── 3. Drop the class from the teacher's lookup hint ─────────────────────
  // Best-effort: the user doc is gone whenever the account was deleted, which
  // is the very case this action exists to repair.
  if (shouldStrip) {
    const userRef = db.collection('users').doc(userId!);
    if ((await userRef.get()).exists) {
      await userRef.update({ adminClassIds: FieldValue.arrayRemove(classId) });
    }
  }

  // ── 4. Clear the invite records ─────────────────────────────────────────
  // An invite left at status 'accepted' is exactly what breaks a later
  // re-link: the app only writes the class when it sees a pending -> accepted
  // *transition*, so a stale accepted row means that edge can never fire
  // again. Deleting them keeps re-linking honest.
  const invites = await db
    .collection('adminInvites')
    .where('email', '==', email)
    .where('classId', '==', classId)
    .get();
  for (let i = 0; i < invites.docs.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const doc of invites.docs.slice(i, i + BATCH_LIMIT)) batch.delete(doc.ref);
    await batch.commit();
  }

  // ── 5. Commit: remove the entry, and close the rules gate immediately ────
  await classRef.update({
    admins: remaining,
    ...(shouldStrip ? { adminUserIds: FieldValue.arrayRemove(userId) } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // ── 6. Audit trail (read by nothing; exists so support actions are traceable)
  await db.collection('adminAuditLog').add({
    action: 'class.unlinkTeacher',
    actorUid: actor.uid,
    actorEmail: actor.email,
    classId,
    className: classData.name,
    targetUserId: userId,
    targetEmail: email,
    invitesDeleted: invites.size,
    stripped,
    createdAt: FieldValue.serverTimestamp(),
  });

  return {
    classId,
    className: classData.name,
    teacherEmail: email,
    removedUserId: userId,
    stripped,
  };
}
