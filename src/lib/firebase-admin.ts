import 'server-only';

import { readFileSync } from 'node:fs';
import { cert, getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * Admin SDK singleton. Mirrors the getApps()-guard pattern in
 * ../ilmTrack/src/config/firebase.ts so hot reload doesn't re-init.
 *
 * The Admin SDK bypasses Firestore security rules entirely. That is
 * deliberate: it is how this portal reads across every teacher's data
 * without touching ilmTrack's firestore.rules. Authorization is enforced
 * by requirePermission() in ./auth/session.ts instead — never skip it.
 *
 * Initialization is lazy so that `next build`, which imports every route
 * module to collect page data, does not need a service account key.
 */

function isEmulator(): boolean {
  return process.env.FIREBASE_USE_EMULATOR === 'true';
}

function createApp(): App {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  if (isEmulator()) {
    const host = process.env.FIREBASE_EMULATOR_HOST || '127.0.0.1';
    // The Admin SDK reads these env vars when it opens a connection.
    process.env.FIRESTORE_EMULATOR_HOST ||= `${host}:8080`;
    process.env.FIREBASE_AUTH_EMULATOR_HOST ||= `${host}:9099`;
    // No real credential is needed or wanted against the emulator.
    return initializeApp({ projectId: projectId || 'ilmtrack-admin-local' });
  }

  return initializeApp({ credential: cert(loadServiceAccount()), projectId });
}

/**
 * The service account, from an environment variable or a file on disk.
 *
 * Two sources, in order:
 *
 *   FIREBASE_SERVICE_ACCOUNT_JSON — the key's contents. This is the one that
 *     works on a host with no writable checkout, such as Netlify, where the
 *     key cannot be a file because service-account/ is gitignored. Accepts
 *     either raw JSON or base64, since some dashboards mangle the embedded
 *     newlines in private_key when a multi-line value is pasted.
 *
 *   FIREBASE_SERVICE_ACCOUNT_PATH — a path to the key. Convenient locally.
 *
 * Exported for tests; prefer getAdminDb()/getAdminAuth() everywhere else.
 */
export function loadServiceAccount(): Record<string, string> {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

  if (!inline && !keyPath) {
    throw new Error(
      'No service account credential. Set FIREBASE_SERVICE_ACCOUNT_JSON to the ' +
        'contents of your key (hosted deploys), or FIREBASE_SERVICE_ACCOUNT_PATH ' +
        'to a path on disk (local). See .env.example.'
    );
  }

  const source = inline ? 'FIREBASE_SERVICE_ACCOUNT_JSON' : `"${keyPath}"`;
  let raw: string;

  if (inline) {
    // A value that does not start with "{" is assumed to be base64.
    raw = inline.startsWith('{') ? inline : Buffer.from(inline, 'base64').toString('utf8');
  } else {
    try {
      raw = readFileSync(keyPath!, 'utf8');
    } catch (error) {
      throw new Error(
        `Could not read the service account key at ${source}: ${(error as Error).message}`
      );
    }
  }

  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `The service account in ${source} is not valid JSON: ${(error as Error).message}`
    );
  }

  // The usual mistake is pasting the *web* config (apiKey, appId, …) instead of
  // the service account, which fails much later with an opaque auth error.
  const missing = ['project_id', 'private_key', 'client_email'].filter((key) => !parsed[key]);
  if (missing.length > 0) {
    throw new Error(
      `The service account in ${source} is missing ${missing.join(', ')}. ` +
        'This should be the JSON from Firebase Console > Project Settings > ' +
        'Service accounts > Generate new private key — not the web app config.'
    );
  }

  return parsed;

}

function adminApp(): App {
  return getApps().length === 0 ? createApp() : getApp();
}

export function getAdminAuth(): Auth {
  return getAuth(adminApp());
}

export function getAdminDb(): Firestore {
  return getFirestore(adminApp());
}
