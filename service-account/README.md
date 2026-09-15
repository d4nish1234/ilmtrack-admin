# Service account keys

Put your Firebase service account JSON here. **Nothing in this folder is
tracked by git** — the `.gitignore` alongside this file ignores everything
except itself and this README.

## Getting a key

Firebase Console → ⚙ Project Settings → **Service accounts** →
*Generate new private key*. Save the downloaded file here, e.g.:

```
service-account/serviceAccountKey.json
```

Then point `.env.local` at it:

```
FIREBASE_SERVICE_ACCOUNT_PATH=./service-account/serviceAccountKey.json
```

## Handle with care

This key grants full read/write access to every ilmTrack user's data and
bypasses all Firestore security rules. Treat it like a password: never commit
it, never paste it into a chat or issue, and don't email it to yourself. If it
leaks, revoke it immediately in the Firebase Console under Service accounts →
Manage keys.

Not needed when running against the emulator (`FIREBASE_USE_EMULATOR=true`).
