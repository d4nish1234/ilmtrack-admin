/**
 * Organization administration: who may be made an admin, and the guards that
 * stop an organization becoming unmanageable.
 *
 * Runs against the Firestore emulator — never production. Start it first:
 *
 *   cd ../ilmTrack && firebase emulators:start --only firestore
 *   cd ../ilmTrack-admin && npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import {
  ManageOrgError,
  createOrganization,
  removeOrgMember,
  setClassOrg,
  setOrgMember,
} from '@/lib/actions/manage-org';
import type { Organization } from '@/types';

const PROJECT_ID = 'ilmtrack-admin-test';
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIRESTORE_EMULATOR_HOST = EMULATOR;

const app = initializeApp({ projectId: PROJECT_ID }, `org-test-${Date.now()}`);
const db: Firestore = getFirestore(app);

const ACTOR = { uid: 'admin-uid', email: 'admin@example.com' };
const TEACHER = 'teacher-uid';
const TEACHER_2 = 'teacher-2';
const PARENT = 'parent-uid';

async function clear() {
  await fetch(
    `http://${EMULATOR}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' }
  );
}

async function seed() {
  const now = Timestamp.now();
  await db.collection('users').doc(TEACHER).set({
    uid: TEACHER, email: 'teacher@example.com', firstName: 'T', lastName: 'One',
    role: 'teacher', createdAt: now, updatedAt: now,
  });
  await db.collection('users').doc(TEACHER_2).set({
    uid: TEACHER_2, email: 'teacher2@example.com', firstName: 'T', lastName: 'Two',
    role: 'teacher', createdAt: now, updatedAt: now,
  });
  await db.collection('users').doc(PARENT).set({
    uid: PARENT, email: 'parent@example.com', firstName: 'P', lastName: 'One',
    role: 'parent', createdAt: now, updatedAt: now,
  });
  await db.collection('classes').doc('class-1').set({
    name: 'Hifz A', teacherId: TEACHER, admins: [], adminUserIds: [],
    studentCount: 0, createdAt: now, updatedAt: now,
  });
}

const org = async (id: string) =>
  (await db.collection('organizations').doc(id).get()).data() as Organization;

beforeAll(clear);
beforeEach(async () => { await clear(); await seed(); });
afterAll(async () => { await deleteApp(app); });

describe('manage-org', () => {
  it('creates an organization and rejects a duplicate name', async () => {
    const { id } = await createOrganization(db, { name: 'ICCM', actor: ACTOR });
    expect((await org(id)).name).toBe('ICCM');
    await expect(createOrganization(db, { name: 'ICCM', actor: ACTOR })).rejects.toThrow(
      ManageOrgError
    );
  });

  it('rejects a blank name', async () => {
    await expect(createOrganization(db, { name: '   ', actor: ACTOR })).rejects.toThrow(
      ManageOrgError
    );
  });

  it('adds a member and keeps memberUserIds in step', async () => {
    const { id } = await createOrganization(db, { name: 'ICCM', actor: ACTOR });
    await setOrgMember(db, { orgId: id, userId: TEACHER, role: 'owner', actor: ACTOR });

    const after = await org(id);
    expect(after.members.map((m) => m.userId)).toEqual([TEACHER]);
    // The derived array is written in the same operation, never by a trigger.
    expect(after.memberUserIds).toEqual([TEACHER]);
  });

  it('REFUSES to make a parent an org admin', async () => {
    const { id } = await createOrganization(db, { name: 'ICCM', actor: ACTOR });
    await expect(
      setOrgMember(db, { orgId: id, userId: PARENT, role: 'admin', actor: ACTOR })
    ).rejects.toThrow(/not a teacher|Only teachers/i);
  });

  it('REFUSES a user with no ilmTrack account', async () => {
    const { id } = await createOrganization(db, { name: 'ICCM', actor: ACTOR });
    await expect(
      setOrgMember(db, { orgId: id, userId: 'ghost', role: 'admin', actor: ACTOR })
    ).rejects.toThrow(ManageOrgError);
  });

  it('changing someone\'s role replaces rather than duplicates them', async () => {
    const { id } = await createOrganization(db, { name: 'ICCM', actor: ACTOR });
    await setOrgMember(db, { orgId: id, userId: TEACHER, role: 'admin', actor: ACTOR });
    await setOrgMember(db, { orgId: id, userId: TEACHER, role: 'owner', actor: ACTOR });

    const after = await org(id);
    expect(after.members).toHaveLength(1);
    expect(after.members[0].role).toBe('owner');
    expect(after.memberUserIds).toEqual([TEACHER]);
  });

  it('REFUSES to remove the last owner', async () => {
    // An organization with no owner cannot be handed on, and its classes
    // become administrable by nobody but a super-admin.
    const { id } = await createOrganization(db, { name: 'ICCM', actor: ACTOR });
    await setOrgMember(db, { orgId: id, userId: TEACHER, role: 'owner', actor: ACTOR });
    await expect(
      removeOrgMember(db, { orgId: id, userId: TEACHER, actor: ACTOR })
    ).rejects.toThrow(/last owner/i);
  });

  it('allows removing an owner once another owner exists', async () => {
    const { id } = await createOrganization(db, { name: 'ICCM', actor: ACTOR });
    await setOrgMember(db, { orgId: id, userId: TEACHER, role: 'owner', actor: ACTOR });
    await setOrgMember(db, { orgId: id, userId: TEACHER_2, role: 'owner', actor: ACTOR });
    await removeOrgMember(db, { orgId: id, userId: TEACHER, actor: ACTOR });

    const after = await org(id);
    expect(after.members.map((m) => m.userId)).toEqual([TEACHER_2]);
    expect(after.memberUserIds).toEqual([TEACHER_2]);
  });

  it('assigns a class to an organization and takes it out again', async () => {
    const { id } = await createOrganization(db, { name: 'ICCM', actor: ACTOR });
    await setClassOrg(db, { classId: 'class-1', orgId: id, actor: ACTOR });
    expect((await db.collection('classes').doc('class-1').get()).data()!.orgId).toBe(id);

    await setClassOrg(db, { classId: 'class-1', orgId: null, actor: ACTOR });
    expect((await db.collection('classes').doc('class-1').get()).data()!.orgId).toBeUndefined();
  });

  it('REFUSES to assign a class to an organization that does not exist', async () => {
    await expect(
      setClassOrg(db, { classId: 'class-1', orgId: 'nope', actor: ACTOR })
    ).rejects.toThrow(ManageOrgError);
  });

  it('writes an audit entry for every mutation', async () => {
    const { id } = await createOrganization(db, { name: 'ICCM', actor: ACTOR });
    await setOrgMember(db, { orgId: id, userId: TEACHER, role: 'owner', actor: ACTOR });
    await setClassOrg(db, { classId: 'class-1', orgId: id, actor: ACTOR });

    const log = await db.collection('adminAuditLog').get();
    expect(log.docs.map((d) => d.data().action).sort()).toEqual([
      'org.create', 'org.setClassOrg', 'org.setMember',
    ]);
  });
});
