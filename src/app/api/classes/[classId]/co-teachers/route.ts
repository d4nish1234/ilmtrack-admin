import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { ApiAuthError, requireApiPermission } from '@/lib/auth/session';
import { LinkTeacherError, linkTeacherToClass } from '@/lib/actions/link-teacher';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ classId: string }> }
) {
  try {
    const session = await requireApiPermission('classes:linkTeacher');
    const { classId } = await params;
    const { teacherUserId } = await request.json();

    if (!teacherUserId || typeof teacherUserId !== 'string') {
      return NextResponse.json({ error: 'Pick a teacher first.' }, { status: 400 });
    }

    const result = await linkTeacherToClass(getAdminDb(), {
      classId,
      teacherUserId,
      actor: { uid: session.uid, email: session.email },
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof LinkTeacherError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('link teacher failed:', error);
    return NextResponse.json(
      { error: 'Something went wrong. Check the server logs.' },
      { status: 500 }
    );
  }
}
