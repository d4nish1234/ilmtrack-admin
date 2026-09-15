import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAdminAuth } from '@/lib/firebase-admin';
import { isRole } from '@/lib/auth/roles';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_MS,
  isAllowlistedEmail,
} from '@/lib/auth/session';

/** Exchange a Firebase ID token for a session cookie. */
export async function POST(request: Request) {
  let idToken: string | undefined;
  try {
    ({ idToken } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  if (!idToken) {
    return NextResponse.json({ error: 'Missing idToken.' }, { status: 400 });
  }

  let claims;
  try {
    claims = await getAdminAuth().verifyIdToken(idToken, true);
  } catch {
    return NextResponse.json({ error: 'Invalid or expired sign-in.' }, { status: 401 });
  }

  // Gate 1: the env allowlist.
  if (!isAllowlistedEmail(claims.email)) {
    return NextResponse.json(
      { error: 'This account is not an ilmTrack admin.' },
      { status: 403 }
    );
  }

  // Gate 2: a known role claim.
  if (!isRole(claims.role)) {
    return NextResponse.json(
      {
        error:
          'This account has no admin role yet. Run `npm run grant`, then sign out and back in.',
      },
      { status: 403 }
    );
  }

  const sessionCookie = await getAdminAuth().createSessionCookie(idToken, {
    expiresIn: SESSION_MAX_AGE_MS,
  });

  (await cookies()).set(SESSION_COOKIE, sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_MS / 1000,
  });

  return NextResponse.json({ ok: true });
}

/** Sign out. */
export async function DELETE() {
  (await cookies()).delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
