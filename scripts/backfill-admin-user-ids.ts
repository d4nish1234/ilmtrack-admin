/**
 * One-off: populate classes/{id}.adminUserIds in the ilmTrack project.
 *
 *   npm run backfill:admin-ids -- --check   # report only, exit 1 if work remains
 *   npm run backfill:admin-ids              # write
 *
 * ../ilmTrack/firestore.rules reads this field to decide whether a co-teacher
 * may update a class, replacing the isAdminOfClass() helper that let any user
 * self-grant access. Until every class has it, co-teachers would be denied —
 * so this must run, and be verified with --check, BEFORE those rules deploy.
 *
 * Safe to run repeatedly: it writes only where the value differs, and computes
 * exactly what the syncClassAdminUserIds Cloud Function computes, so the two
 * cannot disagree.
 */
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, type DocumentData } from 'firebase-admin/firestore';
import type { Admin, Class } from '@/types';

config({ path: '.env.local' });
config({ path: '.env' });

const checkOnly = process.argv.includes('--check');
const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

if (!keyPath) {
  console.error('FIREBASE_SERVICE_ACCOUNT_PATH is not set. See .env.example.');
  process.exit(1);
}

initializeApp({
  credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
});

/** Owner + accepted co-teachers. Mirrors syncClassAdminUserIds exactly. */
function expectedFor(data: DocumentData): string[] {
  const admins = (data.admins || []) as Admin[];
  const ids = [
    data.teacherId as string,
    ...admins.filter((a) => a.userId && a.inviteStatus === 'accepted').map((a) => a.userId!),
  ].filter(Boolean);
  return [...new Set(ids)].sort();
}

// Wrapped in main() rather than top-level await: tsx compiles this as CommonJS.
async function main() {
  const db = getFirestore();
  const classes = await db.collection('classes').get();

  let correct = 0;
  const pending: Array<{ id: string; name: string; ids: string[] }> = [];

  for (const doc of classes.docs) {
    const data = doc.data() as Class & DocumentData;
    const expected = expectedFor(data);
    const current = [...(((data as DocumentData).adminUserIds as string[]) || [])].sort();
    const same = expected.length === current.length && expected.every((id, i) => id === current[i]);

    if (same) correct++;
    else pending.push({ id: doc.id, name: data.name, ids: expected });
  }

  console.log(
    `classes: ${classes.size}   already correct: ${correct}   needing update: ${pending.length}`
  );
  for (const p of pending) {
    console.log(`  ${p.id}  "${p.name}"  -> ${p.ids.length} member(s)`);
  }

  if (checkOnly) {
    console.log(
      pending.length === 0
        ? '\nAll classes correct — the rules change is safe to deploy.'
        : '\nRun without --check to write these.'
    );
    process.exit(pending.length === 0 ? 0 : 1);
  }

  for (const p of pending) {
    await db.collection('classes').doc(p.id).update({ adminUserIds: p.ids });
  }
  console.log(`\nupdated ${pending.length} class(es). Re-run with --check to verify.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
