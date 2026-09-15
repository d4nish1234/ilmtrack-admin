'use client';

import { getApp, getApps, initializeApp } from 'firebase/app';
import { browserLocalPersistence, connectAuthEmulator, getAuth, setPersistence } from 'firebase/auth';

/**
 * Browser Firebase app — used for *authentication only*.
 *
 * There is intentionally no Firestore export here. All data access goes
 * through server components and route handlers using the Admin SDK, so the
 * browser never queries Firestore and ilmTrack's security rules stay as-is.
 */
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Without this, a missing value surfaces as an opaque `auth/invalid-api-key`
// at module evaluation. The usual cause is copying ../ilmTrack/.env verbatim:
// those are named EXPO_PUBLIC_*, and Next.js only exposes NEXT_PUBLIC_* to the
// browser, so every value reads as undefined.
const missing = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => `NEXT_PUBLIC_FIREBASE_${key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`);

if (missing.length > 0) {
  throw new Error(
    `Missing Firebase config in .env.local: ${missing.join(', ')}. ` +
      'Copy the values from ../ilmTrack/.env and rename the EXPO_PUBLIC_ prefix ' +
      'to NEXT_PUBLIC_. See .env.example.'
  );
}

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const clientAuth = getAuth(app);

if (process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR === 'true') {
  const host = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST || '127.0.0.1';
  connectAuthEmulator(clientAuth, `http://${host}:9099`, { disableWarnings: true });
}

// The session cookie is the real credential; keep the client session local only.
void setPersistence(clientAuth, browserLocalPersistence);
