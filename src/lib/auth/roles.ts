/**
 * The single source of truth for who may do what.
 *
 * A role is resolved once per request by resolveRole() in ./session.ts, which
 * knows the two ways an account can earn one:
 *
 *   super-admin — email in ADMIN_EMAILS *and* a `{ role: 'super-admin' }`
 *                 custom claim set by `npm run grant`.
 *   teacher     — a verified ilmTrack account whose users/{uid} doc says
 *                 role: 'teacher'. No per-person setup; any teacher can
 *                 sign in, and sees only their own classes.
 *
 * To add a role later, add it to ROLES, give it a permission list here, and
 * add its branch to canSeeClass() in src/lib/data/classes.ts. No page or
 * route handler needs to change shape.
 */

export const ROLES = ['super-admin', 'teacher'] as const;
export type Role = (typeof ROLES)[number];

export type Permission =
  | 'classes:read'
  | 'classes:linkTeacher'
  | 'teachers:read'
  | 'reports:read';

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  'super-admin': ['classes:read', 'classes:linkTeacher', 'teachers:read', 'reports:read'],
  // Reports only. A teacher has no 'classes:read', so the cross-teacher class
  // list and detail pages stay closed to them; which classes they may report
  // on is a separate question, answered by canSeeClass() in data/classes.ts.
  teacher: ['reports:read'],
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Where a role lands after sign-in, and where "/" sends it. */
export function landingPath(role: Role): string {
  return role === 'teacher' ? '/reports' : '/classes';
}
