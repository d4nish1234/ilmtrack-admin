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

  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!keyPath) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_PATH is not set. Download a service account key ' +
        '(Firebase Console > Project Settings > Service accounts) and point this at it. ' +
        'See .env.example.'
    );
  }

  let serviceAccount: Record<string, string>;
  try {
    serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Could not read the service account key at "${keyPath}": ${(error as Error).message}`
    );
  }

  return initializeApp({ credential: cert(serviceAccount), projectId });
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
