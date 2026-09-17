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
  The `(admin)` shell layout is the sole exception — it calls
  `requireSession()`, because any role may render a header.
- **Two kinds of user**, both resolved by `resolveRole()` in
  `src/lib/auth/session.ts`: super-admins (`ADMIN_EMAILS` + a granted custom
  claim) and teachers (verified email + `users/{uid}.role == 'teacher'`).
  Sign-in and every later request go through that one function; keep it that
  way so a cookie can never be minted for an account `getSession()` would
  then reject.
- **Class visibility** is decided in one place: `canSeeClass()` in
  `src/lib/data/classes.ts`, reached by `getVisibleClass()` and
  `visibleClassDocs()`. Scope new roles there, not in pages. It reads the
  class document, never `users/{uid}.adminClassIds` — that array is a lookup
  hint and is known to drift.
- **Types in `src/types/` are hand-copied** from `../ilmTrack/src/types/`
  because the two apps use different Firebase SDKs (different `Timestamp`
  classes). Keep them in sync by hand. `src/lib/reports/rows.ts` is a
  hand-port of `../ilmTrack/src/utils/reportUtils.ts` for the same reason —
  keep the arithmetic identical so both surfaces report the same totals.
- **Report state lives in the URL**, and each control writes exactly one
  parameter and copies the rest (`src/lib/reports/query.ts`). That is what
  keeps the class picker from disturbing the date range and vice versa; do
  not move either into component state.
- **Report date ranges are filtered by Firestore**, which needs the two
  composite indexes named in `src/lib/data/reports.ts` and in the README's
  setup steps. Adding a range filter to a query needs a composite index;
  equality filters alone do not. Those indexes serve only this console — the
  app's rules force an identity filter into every list query, so it can never
  issue these.
- **Mutations must be safe to re-run.** Both write actions in
  `src/lib/actions/` are designed so an interrupted run is fixed by running it
  again: writes set absolute values, never relative ones, and
  `transfer-student.ts` moves history *before* the student doc for that
  reason. Counters are the exception — they go in a transaction and are
  derived from a real count.
- **Shared parent email means siblings, not duplicates.** Most families have
  several children enrolled. Only the same name *and* a shared parent
  indicates one child recorded twice; see the guard in `transfer-student.ts`.
- **Tests need the Firestore emulator**: `cd ../ilmTrack && firebase
  emulators:start --only firestore`, then `npm test`. They never touch production.
- **Scripts run through `tsx` as CommonJS** (no `"type": "module"`), so no
  top-level `await` in `scripts/` — wrap in `main()`.

<!-- END:project-notes -->
