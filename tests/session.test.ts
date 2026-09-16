/**
 * Who is allowed in, and with which role.
 *
 * resolveRole() is the single gate: the sign-in route uses it to decide
 * whether to mint a cookie, and every later request uses it again through
 * getSession(). These tests drive it directly with decoded-token shapes, so
 * they cover the branches that a browser walkthrough would take several
 * accounts to reach.
 *
 * Needs the Firestore emulator for the user-document lookup:
 *   cd ../ilmTrack && firebase emulators:start --only firestore
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { Timestamp } from 'firebase-admin/firestore';

const PROJECT_ID = 'ilmtrack-admin-test';
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

process.env.FIRESTORE_EMULATOR_HOST = EMULATOR;
process.env.FIREBASE_USE_EMULATOR = 'true';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = PROJECT_ID;
process.env.ADMIN_EMAILS = 'boss@example.com, Granted.Admin@Example.com';

let resolveRole: typeof import('@/lib/auth/session').resolveRole;
let db: import('firebase-admin/firestore').Firestore;

beforeAll(async () => {
  ({ resolveRole } = await import('@/lib/auth/session'));
  db = (await import('@/lib/firebase-admin')).getAdminDb();
});

/** A decoded token, with only the fields resolveRole() reads. */
function token(overrides: Partial<DecodedIdToken> & { uid: string }): DecodedIdToken {
  return { email_verified: true, ...overrides } as DecodedIdToken;
}

async function seedUser(uid: string, role: 'teacher' | 'parent') {
  const now = Timestamp.now();
  await db.collection('users').doc(uid).set({
    uid, email: `${uid}@example.com`, firstName: 'A', lastName: 'B', role,
    createdAt: now, updatedAt: now,
  });
}

beforeEach(async () => {
  await fetch(
    `http://${EMULATOR}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' }
  );
  await seedUser('teacher-uid', 'teacher');
  await seedUser('parent-uid', 'parent');
});

describe('the super-admin gate', () => {
  it('admits an allowlisted email carrying the granted claim', async () => {
    const result = await resolveRole(
      token({ uid: 'boss-uid', email: 'boss@example.com', role: 'super-admin' })
    );
    expect(result).toEqual({ ok: true, role: 'super-admin' });
  });

  it('compares the allowlist case-insensitively', async () => {
    const result = await resolveRole(
      token({ uid: 'boss-uid', email: 'granted.admin@example.com', role: 'super-admin' })
    );
    expect(result.ok).toBe(true);
  });

  it('rejects the claim when the email has been removed from the allowlist', async () => {
    // This is the gate that takes effect immediately: the claim is still on
    // the account, but the env file no longer lists them.
    const result = await resolveRole(
      token({ uid: 'ex-boss', email: 'ex@example.com', role: 'super-admin' })
    );
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown role claim', async () => {
    const result = await resolveRole(
      token({ uid: 'boss-uid', email: 'boss@example.com', role: 'root' })
    );
    expect(result.ok).toBe(false);
  });

  it('tells an allowlisted admin whose claim is missing to run the grant script', async () => {
    const result = await resolveRole(token({ uid: 'boss-uid', email: 'boss@example.com' }));
    expect(result).toMatchObject({ ok: false });
    expect((result as { message: string }).message).toContain('npm run grant');
  });

  it('lets an allowlisted admin who is also a teacher in before the claim exists', async () => {
    await seedUser('boss-uid', 'teacher');
    const result = await resolveRole(token({ uid: 'boss-uid', email: 'boss@example.com' }));
    expect(result).toEqual({ ok: true, role: 'teacher' });
  });
});

describe('the teacher gate', () => {
  it('admits a verified ilmTrack teacher with no allowlist entry at all', async () => {
    const result = await resolveRole(
      token({ uid: 'teacher-uid', email: 'teacher-uid@example.com' })
    );
    expect(result).toEqual({ ok: true, role: 'teacher' });
  });

  it('turns a parent away, and says where their records are', async () => {
    const result = await resolveRole(token({ uid: 'parent-uid', email: 'parent@example.com' }));
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toContain('for teachers');
  });

  it('turns away an unverified email without even reading the user document', async () => {
    const result = await resolveRole(
      token({ uid: 'teacher-uid', email: 'teacher-uid@example.com', email_verified: false })
    );
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toContain('Verify your email');
  });

  it('turns away a signed-in account with no ilmTrack user document', async () => {
    const result = await resolveRole(token({ uid: 'ghost-uid', email: 'ghost@example.com' }));
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toContain('No ilmTrack account');
  });

  it('never hands a teacher a role they could use to reach admin pages', async () => {
    const { can } = await import('@/lib/auth/roles');
    const result = await resolveRole(
      token({ uid: 'teacher-uid', email: 'teacher-uid@example.com' })
    );
    const role = (result as { role: 'teacher' }).role;
    expect(can(role, 'reports:read')).toBe(true);
    expect(can(role, 'classes:read')).toBe(false);
    expect(can(role, 'classes:linkTeacher')).toBe(false);
    expect(can(role, 'teachers:read')).toBe(false);
  });
});
