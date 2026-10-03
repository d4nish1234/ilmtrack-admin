/**
 * Repair invitedTeacherIds on records whose class membership has drifted.
 *
 *   npm run repair:access -- --check   # report only, exit 1 if work remains
 *   npm run repair:access              # write
 *
 * Why this is needed: the mobile app's addAdmin() backfills the new co-teacher
 * onto records matching `classId == X AND teacherId == classOwner`. Homework
 * and attendance are created with teacherId = *the creator*, so everything a
 * co-teacher authored is skipped, and later co-teachers never gain access to
 * it. (Students escape because they are always created under the owner's id,
 * which is why they show zero drift.) `onTeacherRemoved` compounds it: one
 * unchunked batch, so on classes over 500 records it fails and is swallowed.
 *
 * This only ever *adds* uids that class membership says belong. It never
 * removes, so it cannot revoke access by running.
 *
 * Idempotent: writes only where the value differs. Chunked at 450 — Firestore
 * allows 500 writes per batch, and the classes this fixes are the big ones.
 */
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { Admin } from '@/types';

config({ path: '.env.local' });
config({ path: '.env' });

const BATCH_LIMIT = 450;
const COLLECTIONS = ['students', 'homework', 'attendance'] as const;

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

async function main() {
  const db = getFirestore();

  // Class membership is the source of truth: owner + accepted co-teachers.
  const classes = await db.collection('classes').get();
  const members = new Map<string, string[]>();
  const names = new Map<string, string>();
  for (const doc of classes.docs) {
    const data = doc.data();
    const ids = new Set<string>([data.teacherId]);
    for (const a of (data.admins || []) as Admin[]) {
      if (a.userId && a.inviteStatus === 'accepted') ids.add(a.userId);
    }
    members.set(doc.id, [...ids].filter(Boolean));
    names.set(doc.id, data.name);
  }

  let totalDrift = 0;
  const writes: Array<{ ref: FirebaseFirestore.DocumentReference; add: string[] }> = [];

  for (const collection of COLLECTIONS) {
    const snap = await db.collection(collection).get();
    const perClass = new Map<string, number>();

    for (const doc of snap.docs) {
      const data = doc.data();
      const want = members.get(data.classId);
      if (!want) continue; // orphaned record; class deleted

      const have = new Set<string>(data.invitedTeacherIds || []);
      const missing = want.filter((uid) => !have.has(uid));
      if (missing.length === 0) continue;

      perClass.set(data.classId, (perClass.get(data.classId) || 0) + 1);
      totalDrift++;
      writes.push({ ref: doc.ref, add: missing });
    }

    const affected = [...perClass.entries()];
    console.log(
      `${collection.padEnd(11)} ${snap.size} records, ${affected.length} class(es) drifted`
    );
    for (const [classId, count] of affected) {
      console.log(`   "${names.get(classId)}"  ${count} record(s)`);
    }
  }

  console.log(`\ntotal records to repair: ${totalDrift}`);

  if (checkOnly) {
    console.log(totalDrift === 0 ? 'No drift — nothing to do.' : 'Run without --check to repair.');
    process.exit(totalDrift === 0 ? 0 : 1);
  }
  if (totalDrift === 0) process.exit(0);

  for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + BATCH_LIMIT)) {
      batch.update(w.ref, { invitedTeacherIds: FieldValue.arrayUnion(...w.add) });
    }
    await batch.commit();
    console.log(`  committed ${Math.min(i + BATCH_LIMIT, writes.length)}/${writes.length}`);
  }

  console.log('\nrepaired. Re-run with --check to verify.');
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
