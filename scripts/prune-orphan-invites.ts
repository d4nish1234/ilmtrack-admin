/**
 * Delete adminInvites whose class no longer exists.
 *
 *   npm run prune:invites -- --check    # report only, exit 1 if work remains
 *   npm run prune:invites -- --confirm  # delete
 *
 * Why this collection and not invitedTeacherIds: phase 4 deletes that array
 * wholesale, so pruning it is work thrown away. adminInvites survives phase 4
 * — link-teacher.ts, unlink-teacher.ts and the app's acceptPendingAdminInvites
 * all still read it — so orphans here persist indefinitely.
 *
 * An orphan is an invite naming a classId with no class document. The app
 * re-accepts invites on sign-in (acceptPendingAdminInvites), so an invite to a
 * deleted class is re-read on every sign-in and can never resolve.
 *
 * Unlike repair:access, the destructive path needs --confirm rather than being
 * the bare default: this deletes, and a delete has no idempotent re-run.
 * Chunked at 450 — Firestore allows 500 writes per batch.
 */
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

config({ path: '.env.local' });
config({ path: '.env' });

const BATCH_LIMIT = 450;

const checkOnly = process.argv.includes('--check');
const confirmed = process.argv.includes('--confirm');

if (!checkOnly && !confirmed) {
  console.error('Pass --check to report, or --confirm to delete.');
  process.exit(1);
}

const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

if (!keyPath) {
  console.error('FIREBASE_SERVICE_ACCOUNT_PATH is not set. See .env.example.');
  process.exit(1);
}

initializeApp({
  credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
});

async function main() {
  const db = getFirestore();

  // Read every class id first: an invite is an orphan only against the full
  // set, and reading classes per-invite would both cost more and race.
  const classes = await db.collection('classes').get();
  const live = new Set(classes.docs.map((d) => d.id));
  const names = new Map(classes.docs.map((d) => [d.id, d.data().name as string]));

  const invites = await db.collection('adminInvites').get();

  const orphans: { id: string; classId: string; email: string; status: string }[] = [];
  for (const doc of invites.docs) {
    const data = doc.data();
    const classId = data.classId as string | undefined;
    // A missing classId is malformed, not merely orphaned; report it either way
    // rather than silently keeping a document nothing can resolve.
    if (!classId || !live.has(classId)) {
      orphans.push({
        id: doc.id,
        classId: classId ?? '(none)',
        email: (data.email as string) ?? '(none)',
        status: (data.status as string) ?? '(none)',
      });
    }
  }

  console.log(`classes ${live.size} | adminInvites ${invites.size}`);
  console.log(`orphaned invites: ${orphans.length}`);

  if (orphans.length === 0) {
    console.log('No orphans — nothing to do.');
    return;
  }

  for (const o of orphans) {
    console.log(`  ${o.id}  class=${o.classId}  ${o.email}  status=${o.status}`);
  }

  // Name any class that still exists but was flagged: that would mean a bug
  // here, not an orphan, and must stop the run.
  const wrong = orphans.filter((o) => names.has(o.classId));
  if (wrong.length > 0) {
    console.error(`\nABORT: ${wrong.length} flagged invites name a live class.`);
    process.exit(2);
  }

  if (checkOnly) {
    console.log('\n--check: nothing written.');
    process.exit(1);
  }

  let deleted = 0;
  for (let i = 0; i < orphans.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const o of orphans.slice(i, i + BATCH_LIMIT)) {
      batch.delete(db.collection('adminInvites').doc(o.id));
    }
    await batch.commit();
    deleted += Math.min(BATCH_LIMIT, orphans.length - i);
  }

  console.log(`\nDeleted ${deleted} orphaned invites.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
