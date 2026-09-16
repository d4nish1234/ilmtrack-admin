import 'server-only';

import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getAdminAuth, getAdminDb } from '@/lib/firebase-admin';
import type { User } from '@/types';
import { can, isRole, type Permission, type Role } from './roles';

export const SESSION_COOKIE = 'ilmtrack_admin_session';
/** 8 hours. Short on purpose — this is a support tool, not a daily driver. */
export const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

export interface Session {
  uid: string;
  email: string;
  role: Role;
}

/** Emails permitted to use this portal as a super-admin, from ADMIN_EMAILS. */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowlistedEmail(email: string | undefined): boolean {
  if (!email) return false;
  return adminEmails().includes(email.toLowerCase());
}

export type RoleResolution =
  | { ok: true; role: Role }
  | { ok: false; message: string };

/**
 * Decide what a signed-in Firebase account may be here. Shared by the
 * cookie-minting route (POST /api/session) and by every subsequent request
 * via getSession(), so the two can never drift apart.
 *
 * Two independent ways in:
 *
 *   A. super-admin — the email is in ADMIN_EMAILS *and* the account carries a
 *      known `role` custom claim. Both are checked on every request, so
 *      removing someone from the env file locks them out immediately.
 *
 *   B. teacher — the token says the email is verified *and* users/{uid} in
 *      Firestore says role: 'teacher'. The user doc is the authority here:
 *      it is the same record the mobile app writes, so a teacher's access to
 *      this console appears and disappears with their ilmTrack account, with
 *      no allowlist to maintain.
 *
 * Gate B reads the token's `email_verified` claim rather than the user doc's
 * `emailVerified` field. The mobile app only stamps that field on the first
 * verified *login*, so a teacher who verified but has not reopened the app
 * since would be wrongly turned away. The claim is authoritative.
 */
export async function resolveRole(claims: DecodedIdToken): Promise<RoleResolution> {
  const allowlisted = isAllowlistedEmail(claims.email);

  // Gate A.
  if (allowlisted && isRole(claims.role)) {
    return { ok: true, role: claims.role };
  }

  // An allowlisted admin whose claim has not been granted yet falls through to
  // gate B — if they are also an ilmTrack teacher they get in as one, which
  // beats locking them out over a missing claim. If that fails too, this is
  // the failure worth reporting.
  const needsGrant: RoleResolution = {
    ok: false,
    message:
      'This account is on the admin allowlist but has no role yet. ' +
      'Run `npm run grant`, then sign out and back in.',
  };

  // Gate B.
  if (claims.email_verified !== true) {
    return allowlisted
      ? needsGrant
      : { ok: false, message: 'Verify your email in the ilmTrack app, then sign in again.' };
  }

  const snap = await getAdminDb().collection('users').doc(claims.uid).get();
  const user = snap.data() as User | undefined;

  if (user?.role === 'teacher') return { ok: true, role: 'teacher' };
  if (allowlisted) return needsGrant;

  if (!snap.exists) {
    return { ok: false, message: 'No ilmTrack account is linked to this sign-in.' };
  }
  if (user?.role === 'parent') {
    return {
      ok: false,
      message:
        'ilmTrack Admin is for teachers. Parents can see their children\u2019s ' +
        'records in the ilmTrack app.',
    };
  }
  return { ok: false, message: 'This account does not have access to ilmTrack Admin.' };
}

/**
 * The caller's session, or null.
 *
 * Cached per request: gate B costs a Firestore read, and the layout, the page,
 * and the data layer all ask for the session while rendering one response.
 */
export const getSession = cache(async function getSession(): Promise<Session | null> {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!cookie) return null;

  try {
    const claims = await getAdminAuth().verifySessionCookie(cookie, true);
    const resolved = await resolveRole(claims);
    if (!resolved.ok) return null;
    return { uid: claims.uid, email: claims.email!, role: resolved.role };
  } catch {
    // Expired, revoked, or malformed cookie.
    return null;
  }
});

/**
 * For the shell layout: any valid role may render it. Pages inside still call
 * requirePermission() for what they actually show — a teacher passes here but
 * is turned away from /classes.
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

/** For pages: redirects to /login when unauthorized. */
export async function requirePermission(permission: Permission): Promise<Session> {
  const session = await requireSession();
  if (!can(session.role, permission)) redirect('/login?error=forbidden');
  return session;
}

export class ApiAuthError extends Error {
  constructor(readonly status: 401 | 403, message: string) {
    super(message);
  }
}

/** For route handlers: throws ApiAuthError instead of redirecting. */
export async function requireApiPermission(permission: Permission): Promise<Session> {
  const session = await getSession();
  if (!session) throw new ApiAuthError(401, 'Not signed in.');
  if (!can(session.role, permission)) {
    throw new ApiAuthError(403, `Your role (${session.role}) cannot ${permission}.`);
  }
  return session;
}
