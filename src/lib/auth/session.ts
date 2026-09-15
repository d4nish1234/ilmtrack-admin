import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAdminAuth } from '@/lib/firebase-admin';
import { can, isRole, type Permission, type Role } from './roles';

export const SESSION_COOKIE = 'ilmtrack_admin_session';
/** 8 hours. Short on purpose — this is a support tool, not a daily driver. */
export const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

export interface Session {
  uid: string;
  email: string;
  role: Role;
}

/** Emails permitted to use this portal at all, from ADMIN_EMAILS. */
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

/**
 * Two independent gates, both required:
 *   1. the email is in ADMIN_EMAILS (checked on every request, so removing
 *      someone from the env file locks them out immediately), and
 *   2. the account carries a known `role` custom claim.
 */
export async function getSession(): Promise<Session | null> {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!cookie) return null;

  try {
    const claims = await getAdminAuth().verifySessionCookie(cookie, true);
    if (!isAllowlistedEmail(claims.email)) return null;
    if (!isRole(claims.role)) return null;
    return { uid: claims.uid, email: claims.email!, role: claims.role };
  } catch {
    // Expired, revoked, or malformed cookie.
    return null;
  }
}

/** For pages: redirects to /login when unauthorized. */
export async function requirePermission(permission: Permission): Promise<Session> {
  const session = await getSession();
  if (!session) redirect('/login');
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
