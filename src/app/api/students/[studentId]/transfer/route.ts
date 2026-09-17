import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { ApiAuthError, requireApiPermission } from '@/lib/auth/session';
import { getVisibleClass } from '@/lib/data/classes';
import { TransferStudentError, transferStudentToClass } from '@/lib/actions/transfer-student';
import type { Student } from '@/types';

/**
 * Move a student to another class, history included.
 *
 *   POST /api/students/:studentId/transfer  { toClassId, acknowledge? }
 *
 * Both the class the student is leaving and the one they are joining must be
 * visible to the caller, so this cannot be used to reach into a class the
 * role is not scoped to — which matters the moment a narrower role exists.
 *
 * Warnings come back as 409 with a structured body; the caller retries with
 * acknowledge: true. Blockers return 409 too but are never overridable, so
 * the client cannot talk its way past a genuine duplicate.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ studentId: string }> }
) {
  try {
    const session = await requireApiPermission('students:transfer');
    const { studentId } = await params;

    let body: { toClassId?: string; acknowledge?: boolean };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
    }

    const toClassId = body.toClassId?.trim();
    if (!toClassId) {
      return NextResponse.json({ error: 'toClassId is required.' }, { status: 400 });
    }

    // Scope both ends before the action reads anything else. Absent and
    // forbidden are answered identically, as everywhere else.
    const studentSnap = await getAdminDb().collection('students').doc(studentId).get();
    if (!studentSnap.exists) {
      return NextResponse.json({ error: 'Student not found.' }, { status: 404 });
    }
    const student = studentSnap.data() as Student;

    const [fromClass, toClass] = await Promise.all([
      getVisibleClass(session, student.classId),
      getVisibleClass(session, toClassId),
    ]);
    if (!fromClass || !toClass) {
      return NextResponse.json({ error: 'Class not found.' }, { status: 404 });
    }

    const result = await transferStudentToClass(getAdminDb(), {
      studentId,
      toClassId,
      acknowledge: body.acknowledge === true,
      actor: { uid: session.uid, email: session.email },
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof TransferStudentError) {
      const needsReview = error.blockers.length > 0 || error.warnings.length > 0;
      return NextResponse.json(
        { error: error.message, blockers: error.blockers, warnings: error.warnings },
        { status: needsReview ? 409 : 400 }
      );
    }
    throw error;
  }
}
