<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:project-notes -->

# ilmTrack Admin — project notes

Support console for the ilmTrack mobile app (`../ilmTrack`, Expo/React Native).
Read `README.md` first; read `../ilmTrack/CLAUDE.md` for the Firestore data model.

- **Never edit `../ilmTrack`.** This app is deliberately built so that
  `firestore.rules`, the Cloud Functions, and the mobile app stay untouched.
- **All data access is server-side** via `firebase-admin` (`src/lib/firebase-admin.ts`),
  which bypasses security rules. The browser never queries Firestore —
  `src/lib/firebase-client.ts` exports auth only, and deliberately no Firestore.
- **Authorization is this app's job.** Every page calls `requirePermission()`
  and every route handler calls `requireApiPermission()`
  (`src/lib/auth/session.ts`). Permissions live in one table in
  `src/lib/auth/roles.ts`. Do not add a page or endpoint without a guard.
- **Class visibility** is decided in one place: `canSeeClass()` in
  `src/lib/data/classes.ts`. Scope new roles there, not in pages.
- **Types in `src/types/` are hand-copied** from `../ilmTrack/src/types/`
  because the two apps use different Firebase SDKs (different `Timestamp`
  classes). Keep them in sync by hand.
- **Tests need the Firestore emulator**: `cd ../ilmTrack && firebase
  emulators:start --only firestore`, then `npm test`. They never touch production.
- **Scripts run through `tsx` as CommonJS** (no `"type": "module"`), so no
  top-level `await` in `scripts/` — wrap in `main()`.

<!-- END:project-notes -->
