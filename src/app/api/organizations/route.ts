import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { ApiAuthError, requireApiPermission } from '@/lib/auth/session';
import {
  ManageOrgError,
  createOrganization,
  removeOrgMember,
  setClassOrg,
  setOrgMember,
} from '@/lib/actions/manage-org';
import type { OrgRole } from '@/types';

/**
 * Organization administration. Super-admin only — `orgs:manage` is not granted
 * to org-admin, so an admin cannot widen their own reach or anyone else's.
 *
 *   POST /api/organizations   { action: 'create',       name }
 *                             { action: 'setMember',    orgId, userId, role }
 *                             { action: 'removeMember', orgId, userId }
 *                             { action: 'setClassOrg',  classId, orgId | null }
 *
 * One endpoint with an action discriminator rather than four routes: these are
 * all one screen's worth of edits against one small document.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiPermission('orgs:manage');
    const actor = { uid: session.uid, email: session.email };
    const db = getAdminDb();

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
    }

    const str = (key: string): string | undefined =>
      typeof body[key] === 'string' && (body[key] as string).trim()
        ? (body[key] as string).trim()
        : undefined;

    switch (body.action) {
      case 'create': {
        const name = str('name');
        if (!name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 });
        return NextResponse.json(await createOrganization(db, { name, actor }));
      }

      case 'setMember': {
        const [orgId, userId, role] = [str('orgId'), str('userId'), body.role];
        if (!orgId || !userId) {
          return NextResponse.json({ error: 'orgId and userId are required.' }, { status: 400 });
        }
        if (role !== 'owner' && role !== 'admin') {
          return NextResponse.json({ error: 'role must be owner or admin.' }, { status: 400 });
        }
        return NextResponse.json(
          await setOrgMember(db, { orgId, userId, role: role as OrgRole, actor })
        );
      }

      case 'removeMember': {
        const [orgId, userId] = [str('orgId'), str('userId')];
        if (!orgId || !userId) {
          return NextResponse.json({ error: 'orgId and userId are required.' }, { status: 400 });
        }
        return NextResponse.json(await removeOrgMember(db, { orgId, userId, actor }));
      }

      case 'setClassOrg': {
        const classId = str('classId');
        if (!classId) {
          return NextResponse.json({ error: 'classId is required.' }, { status: 400 });
        }
        // null is meaningful here — it removes the class from its organization.
        const orgId = body.orgId === null ? null : str('orgId');
        if (orgId === undefined) {
          return NextResponse.json({ error: 'orgId is required (or null).' }, { status: 400 });
        }
        await setClassOrg(db, { classId, orgId, actor });
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof ManageOrgError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('organization admin failed:', error);
    return NextResponse.json(
      { error: 'Something went wrong. Check the server logs.' },
      { status: 500 }
    );
  }
}
