# ilmTrack Admin

A small internal support console for [ilmTrack](../ilmTrack). Sign in as a
platform admin to see every class — owner, co-teachers, students and their
parents — and to link a registered teacher to any class as a co-teacher.

It exists because the mobile app gates "add co-teacher" on class ownership
([`app/(teacher)/classes/[classId]/edit.tsx`](../ilmTrack/app/\(teacher\)/classes/\[classId\]/edit.tsx)),
so there was no way to help a teacher who needed access to someone else's class.

Read-only apart from that one action. Built to run locally.

## How it fits with the mobile app

- **Same Firebase project.** You sign in with your existing ilmTrack account.
- **ilmTrack is untouched.** No changes to `firestore.rules`, the Cloud
  Functions, or the app. All data access happens server-side through the
  Firebase Admin SDK, which bypasses security rules — so authorization is this
  app's own job, enforced by `requirePermission()` on every page and route.
- **Linking mirrors the app's own flow** (`addAdmin` in
  [`src/services/class.service.ts`](../ilmTrack/src/services/class.service.ts)),
  so the app and its Cloud Functions see exactly the state they expect.

## Setup

1. **Install**

   ```bash
   npm install
   ```

2. **Service account key.** Firebase Console → Project Settings → Service
   accounts → *Generate new private key*. Save the JSON into
   [`service-account/`](service-account/) — everything in that folder is
   gitignored, so it cannot be committed by accident. See
   [`service-account/README.md`](service-account/README.md).

   Not needed if you only run against the emulator.

3. **Environment.** Copy `.env.example` to `.env.local` and fill it in. The
   `NEXT_PUBLIC_FIREBASE_*` values are the same ones in `../ilmTrack/.env`,
   with the `EXPO_PUBLIC_` prefix swapped for `NEXT_PUBLIC_`.

   Set `ADMIN_EMAILS` to your own email (comma-separated for more than one).

4. **Grant yourself the admin role.**

   ```bash
   npm run grant
   ```

   This reads `ADMIN_EMAILS` and sets a `{ role: 'super-admin' }` custom claim
   on each account. Re-run it whenever you change that list.

5. **Run**

   ```bash
   npm run dev     # http://localhost:3000
   ```

## Access control

Two independent gates, both checked on every request:

| Gate | Where | Effect |
| --- | --- | --- |
| Email in `ADMIN_EMAILS` | `src/lib/auth/session.ts` | Removing an email locks that person out immediately |
| A known `role` custom claim | Firebase Auth token | Set by `npm run grant`; takes effect at next sign-in |

Permissions live in one table, [`src/lib/auth/roles.ts`](src/lib/auth/roles.ts):

```ts
const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  'super-admin': ['classes:read', 'classes:linkTeacher', 'teachers:read'],
};
```

Every page calls `requirePermission(...)` and every route handler calls
`requireApiPermission(...)`, and UI affordances render behind the same `can()`
check — so a button and its endpoint can never disagree.

**To add a role later** (say an organization owner who sees only their own
org's classes):

1. Add it to `ROLES` and give it a permission list in `roles.ts`.
2. Widen `canSeeClass()` in [`src/lib/data/classes.ts`](src/lib/data/classes.ts)
   — the single place class visibility is decided, used by both the list and
   the detail page.
3. Set the claim for those users.

No page or route changes shape.

## What linking a teacher does

`POST /api/classes/:classId/co-teachers` →
[`src/lib/actions/link-teacher.ts`](src/lib/actions/link-teacher.ts):

1. Validates: the target is a `teacher`, is not the owner, and is not already
   a co-teacher.
2. Appends `{ email, userId, inviteStatus: 'accepted', … }` to
   `classes/{id}.admins`.
3. Adds the class to `users/{teacher}.adminClassIds`.
4. Backfills `invitedTeacherIds` on every `students`, `homework` and
   `attendance` doc in the class — this is what the security rules read, so
   without it the teacher sees an empty class.
5. Creates an `adminInvites` doc, which fires the existing
   `sendTeacherInviteEmail` Cloud Function. The teacher gets an email naming
   the class.
6. Appends to `adminAuditLog` so support actions are traceable.

Two deliberate differences from the mobile app's `addAdmin`:

- **The backfill filters on `classId` alone.** The app also filters
  `teacherId == owner`, purely to satisfy client-side security rules, which
  silently misses docs a co-teacher created. The `onTeacherInviteAccepted`
  Cloud Function filters on `classId` only, and we match the function. There
  is a regression test for this.
- **Writes are chunked at 450 ops.** A busy class can exceed Firestore's
  500-per-batch limit, which the app's single batch would hit.

The `adminInvites` doc is created already `accepted`, which fires the email
(an `onDocumentCreated` trigger) but *not* `onTeacherInviteAccepted` (an
`onDocumentUpdated` trigger) — which is why we do the backfill ourselves.

Only registered teachers can be linked here. To invite someone who has no
ilmTrack account yet, use the mobile app's pending-invite flow.

## Tests

The mutation is covered against the Firestore emulator. It never touches
production.

```bash
# terminal 1
cd ../ilmTrack && firebase emulators:start --only firestore

# terminal 2
npm test
```

```bash
npm run typecheck
npm run lint
```

## Running against the emulator end to end

To exercise the whole flow including the Cloud Functions and the mobile app:

```bash
cd ../ilmTrack && firebase emulators:start --only auth,firestore,functions
```

Set `FIREBASE_USE_EMULATOR=true` and `NEXT_PUBLIC_FIREBASE_USE_EMULATOR=true`
in `.env.local` here, and `EXPO_PUBLIC_USE_EMULATOR=true` in `../ilmTrack/.env`.
No service account key is needed against the emulator.

Create two teachers and a class with a student in the app, link the second
teacher from this portal, then sign in as them in the app and confirm the
class appears with its students.

## Deploying

Currently local-only. If you ever host it: the session cookie already sets
`secure` in production, but you would need to supply the service account via a
secret rather than a file on disk, and put the whole thing behind network
restrictions — this app can read every user's data by design.
