import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAdminAuth } from '@/lib/firebase-admin';
import { landingPath } from '@/lib/auth/roles';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_MS,
  resolveRole,
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

  // The same resolution every later request performs, so a cookie can never be
  // minted for an account that getSession() would then turn away.
  const resolved = await resolveRole(claims);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.message }, { status: 403 });
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

  // The client cannot read the role (the cookie is httpOnly), so tell it where
  // this account belongs rather than making it guess.
  return NextResponse.json({ ok: true, redirectTo: landingPath(resolved.role) });
}

/** Sign out. */
export async function DELETE() {
  (await cookies()).delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
