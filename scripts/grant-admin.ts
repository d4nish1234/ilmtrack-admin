/**
 * Grant the super-admin custom claim to every email in ADMIN_EMAILS.
 *
 *   npm run grant
 *
 * Run once after setting up .env.local, and again whenever you edit
 * ADMIN_EMAILS. Claims land in the token the next time that user signs in,
 * so sign out and back in after a change.
 */
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

config({ path: '.env.local' });
config({ path: '.env' });

const useEmulator = process.env.FIREBASE_USE_EMULATOR === 'true';
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

if (useEmulator) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||=
    `${process.env.FIREBASE_EMULATOR_HOST || '127.0.0.1'}:9099`;
  initializeApp({ projectId: projectId || 'ilmtrack-admin-local' });
} else {
  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!keyPath) {
    console.error('FIREBASE_SERVICE_ACCOUNT_PATH is not set. See .env.example.');
    process.exit(1);
  }
  initializeApp({
    credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))),
    projectId,
  });
}

const emails = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

if (emails.length === 0) {
  console.error('ADMIN_EMAILS is empty — nothing to grant. See .env.example.');
  process.exit(1);
}

// Wrapped in main() rather than using top-level await: tsx compiles this
// file as CommonJS (package.json has no "type": "module"), which rejects it.
async function main() {
  const auth = getAuth();
  let failed = 0;

  for (const email of emails) {
    try {
      const user = await auth.getUserByEmail(email);
      await auth.setCustomUserClaims(user.uid, { role: 'super-admin' });
      console.log(`  granted super-admin  ${email}  (${user.uid})`);
    } catch (error) {
      failed++;
      const code = (error as { code?: string }).code;
      if (code === 'auth/user-not-found') {
        console.error(`  NOT FOUND            ${email} — no Firebase account with this email`);
      } else {
        console.error(`  FAILED               ${email} — ${(error as Error).message}`);
      }
    }
  }

  console.log(
    `\n${emails.length - failed}/${emails.length} granted. ` +
      'Sign out and back in for the new claim to take effect.'
  );
  process.exit(failed > 0 ? 1 : 0);
}

main();
