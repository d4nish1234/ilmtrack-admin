/**
 * Create and administer organizations. Super-admin tooling — there is
 * deliberately no self-serve path in the app or the console.
 *
 *   npm run org                                 # list orgs and unassigned classes
 *   npm run org -- create "ICCM"                # create an organization
 *   npm run org -- add <orgId> <email> [owner]  # add a member (default: admin)
 *   npm run org -- remove <orgId> <email>       # remove a member
 *   npm run org -- assign <orgId> <classId>...  # put classes in the org
 *   npm run org -- unassign <classId>...        # remove classes from any org
 *
 * Membership lives here rather than in custom claims so that removing an admin
 * takes effect on their next request instead of their next token refresh —
 * see src/lib/data/organizations.ts.
 *
 * `memberUserIds` is maintained here alongside `members`, in one write, rather
 * than by a trigger: this project has no Cloud Functions of its own, and a
 * derived array that drifts is the bug behind todo.md #6 and #7.
 */
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import type { OrgMember, Organization } from '@/types';

config({ path: '.env.local' });
config({ path: '.env' });

const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!keyPath) {
  console.error('FIREBASE_SERVICE_ACCOUNT_PATH is not set. See .env.example.');
  process.exit(1);
}
initializeApp({
  credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
});

const [command, ...args] = process.argv.slice(2).filter((a) => a !== '--');

/** members -> memberUserIds, the one place the derived array is computed. */
function derive(members: OrgMember[]): string[] {
  return [...new Set(members.map((m) => m.userId).filter(Boolean))].sort();
}

async function list() {
  const db = getFirestore();
  const [orgs, classes] = await Promise.all([
    db.collection('organizations').get(),
    db.collection('classes').get(),
  ]);

  if (orgs.empty) console.log('No organizations yet.\n');
  for (const o of orgs.docs) {
    const d = o.data() as Organization;
    console.log(`${d.name}  (${o.id})`);
    for (const m of d.members || []) console.log(`   ${m.role.padEnd(5)} ${m.email}`);
    const owned = classes.docs.filter((c) => c.data().orgId === o.id);
    console.log(`   ${owned.length} class(es): ${owned.map((c) => c.data().name).join(', ') || '—'}\n`);
  }

  const orphans = classes.docs.filter((c) => !c.data().orgId);
  console.log(`classes in no organization (${orphans.length}):`);
  for (const c of orphans) console.log(`   ${c.id}  "${c.data().name}"`);
}

async function main() {
  const db = getFirestore();

  if (!command) return list();

  if (command === 'create') {
    const name = args.join(' ').trim();
    if (!name) throw new Error('Usage: npm run org -- create "Name"');
    const ref = await db.collection('organizations').add({
      name,
      members: [],
      memberUserIds: [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`created "${name}"  ->  ${ref.id}`);
    return;
  }

  if (command === 'add' || command === 'remove') {
    const [orgId, email, role = 'admin'] = args;
    if (!orgId || !email) throw new Error(`Usage: npm run org -- ${command} <orgId> <email> [owner]`);
    if (!['owner', 'admin'].includes(role)) throw new Error(`role must be owner or admin, got "${role}"`);

    const ref = db.collection('organizations').doc(orgId);
    const snap = await ref.get();
    if (!snap.exists) throw new Error(`No organization ${orgId}.`);

    const normalized = email.toLowerCase().trim();
    const members = ((snap.data() as Organization).members || []).filter(
      (m) => m.email.toLowerCase() !== normalized
    );

    if (command === 'add') {
      // Resolved against Auth, not the users collection: the uid is what every
      // authorization check compares, so a typo must fail here and not later.
      const user = await getAuth().getUserByEmail(normalized);
      members.push({ userId: user.uid, email: normalized, role: role as OrgMember['role'] });
    }

    await ref.update({ members, memberUserIds: derive(members), updatedAt: FieldValue.serverTimestamp() });
    console.log(`${command === 'add' ? 'added' : 'removed'} ${normalized}; ${members.length} member(s) now`);
    return;
  }

  if (command === 'assign' || command === 'unassign') {
    const orgId = command === 'assign' ? args.shift() : undefined;
    if (command === 'assign') {
      if (!orgId) throw new Error('Usage: npm run org -- assign <orgId> <classId>...');
      if (!(await db.collection('organizations').doc(orgId).get()).exists) {
        throw new Error(`No organization ${orgId}.`);
      }
    }
    if (args.length === 0) throw new Error('Give at least one classId.');

    for (const classId of args) {
      const ref = db.collection('classes').doc(classId);
      const snap = await ref.get();
      if (!snap.exists) {
        console.log(`  skipped ${classId} — no such class`);
        continue;
      }
      await ref.update({
        orgId: command === 'assign' ? orgId : FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      console.log(`  ${command === 'assign' ? `${classId} -> ${orgId}` : `${classId} -> (none)`}  "${snap.data()!.name}"`);
    }
    return;
  }

  throw new Error(`Unknown command "${command}". Run \`npm run org\` for usage.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
