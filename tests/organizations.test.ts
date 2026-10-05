/**
 * Organization scoping: which classes an org admin may see, and — the part
 * that matters — which they may not.
 *
 * Runs against the Firestore emulator — never production. Start it first:
 *
 *   cd ../ilmTrack && firebase emulators:start --only firestore
 *   cd ../ilmTrack-admin && npm test
 *
 * Env vars are set before the data layer is imported, which is why the imports
 * are dynamic — same reason as tests/reports.test.ts.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';

const PROJECT_ID = 'ilmtrack-admin-test';
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIRESTORE_EMULATOR_HOST = EMULATOR;
process.env.FIREBASE_USE_EMULATOR = 'true';
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = PROJECT_ID;

let classes: typeof import('@/lib/data/classes');
let orgs: typeof import('@/lib/data/organizations');
let db: import('firebase-admin/firestore').Firestore;

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const ADMIN_A = { uid: 'admin-a', email: 'a@example.com', role: 'org-admin' as const, orgIds: [ORG_A] };
const TEACHER = { uid: 'teacher-uid', email: 't@example.com', role: 'teacher' as const, orgIds: [] };

async function clear() {
  await fetch(
    `http://${EMULATOR}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' }
  );
}

beforeAll(async () => {
  classes = await import('@/lib/data/classes');
  orgs = await import('@/lib/data/organizations');
  const admin = await import('@/lib/firebase-admin');
  db = admin.getAdminDb();
});

beforeEach(async () => {
  await clear();
  const now = Timestamp.now();

  await db.collection('organizations').doc(ORG_A).set({
    name: 'Org A',
    members: [{ userId: ADMIN_A.uid, email: ADMIN_A.email, role: 'owner' }],
    memberUserIds: [ADMIN_A.uid],
    createdAt: now, updatedAt: now,
  });
  await db.collection('organizations').doc(ORG_B).set({
    name: 'Org B', members: [], memberUserIds: [], createdAt: now, updatedAt: now,
  });

  const base = { admins: [], adminUserIds: [], studentCount: 0, createdAt: now, updatedAt: now };
  await db.collection('classes').doc('in-a').set({ ...base, name: 'In A', teacherId: 'someone', orgId: ORG_A });
  await db.collection('classes').doc('also-a').set({ ...base, name: 'Also A', teacherId: 'someone', orgId: ORG_A });
  await db.collection('classes').doc('in-b').set({ ...base, name: 'In B', teacherId: 'someone', orgId: ORG_B });
  await db.collection('classes').doc('standalone').set({ ...base, name: 'Standalone', teacherId: 'someone' });
  await db.collection('classes').doc('own').set({ ...base, name: 'Own', teacherId: ADMIN_A.uid });
});

describe('organization scoping', () => {
  it('an org admin sees every class in their organization', async () => {
    const visible = (await classes.visibleClassDocs(ADMIN_A)).map((c) => c.id).sort();
    expect(visible).toContain('in-a');
    expect(visible).toContain('also-a');
  });

  it('an org admin CANNOT see another organization\'s classes', async () => {
    const visible = (await classes.visibleClassDocs(ADMIN_A)).map((c) => c.id);
    expect(visible).not.toContain('in-b');
    expect(await classes.getVisibleClass(ADMIN_A, 'in-b')).toBeNull();
  });

  it('an org admin CANNOT see a class that belongs to no organization', async () => {
    // Guards the empty-orgId case: a class with no orgId must not become
    // visible just because this caller administers an org somewhere.
    const visible = (await classes.visibleClassDocs(ADMIN_A)).map((c) => c.id);
    expect(visible).not.toContain('standalone');
    expect(await classes.getVisibleClass(ADMIN_A, 'standalone')).toBeNull();
  });

  it('an org admin still sees classes they own outside the organization', async () => {
    const visible = (await classes.visibleClassDocs(ADMIN_A)).map((c) => c.id);
    expect(visible).toContain('own');
  });

  it('a plain teacher sees nothing extra from organizations existing', async () => {
    const visible = (await classes.visibleClassDocs(TEACHER)).map((c) => c.id);
    expect(visible).toEqual([]);
  });

  it('orgsForUser finds only the caller\'s organizations', async () => {
    expect((await orgs.orgIdsForUser(ADMIN_A.uid))).toEqual([ORG_A]);
    expect((await orgs.orgIdsForUser('nobody'))).toEqual([]);
  });

  it('classIdsInOrgs lists the organization\'s classes', async () => {
    const ids = await orgs.classIdsInOrgs([ORG_A]);
    expect([...ids].sort()).toEqual(['also-a', 'in-a']);
    expect([...(await orgs.classIdsInOrgs([]))]).toEqual([]);
  });

  it('an org admin is only ever given their own organizations to render', async () => {
    // The page scopes the query rather than filtering a full list, so this is
    // the assertion that matters: ORG_B is never loaded, not merely hidden.
    const mine = await orgs.orgsForUser(ADMIN_A.uid);
    expect(mine.map((o) => o.id)).toEqual([ORG_A]);
    expect(mine.flatMap((o) => o.members.map((m) => m.email))).toEqual([ADMIN_A.email]);
  });

  it('isOrgOwner distinguishes owner from admin', async () => {
    const org = (await orgs.getOrganization(ORG_A))!;
    expect(orgs.isOrgOwner(org, ADMIN_A.uid)).toBe(true);
    expect(orgs.isOrgOwner(org, 'someone-else')).toBe(false);
  });
});
