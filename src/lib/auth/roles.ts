/**
 * The single source of truth for who may do what.
 *
 * Roles live in Firebase custom claims (`{ role: 'super-admin' }`), set by
 * `npm run grant`. To add a role later — say an organization owner who can
 * only see their own org's classes — add it to Role, give it a permission
 * list here, and add the scoping filter in src/lib/data/classes.ts. No page
 * or route handler needs to change shape.
 */

export const ROLES = ['super-admin'] as const;
export type Role = (typeof ROLES)[number];

export type Permission =
  | 'classes:read'
  | 'classes:linkTeacher'
  | 'teachers:read';

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  'super-admin': ['classes:read', 'classes:linkTeacher', 'teachers:read'],
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}
