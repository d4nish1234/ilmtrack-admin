# ilmTrack Admin

A small internal support console for [ilmTrack](../ilmTrack), with two
audiences:

- **Platform admins** see every class — owner, co-teachers, students and their
  parents — and can link a registered teacher to any class as a co-teacher.
  This exists because the mobile app gates "add co-teacher" on class ownership
  ([`app/(teacher)/classes/[classId]/edit.tsx`](../ilmTrack/app/\(teacher\)/classes/\[classId\]/edit.tsx)),
  so there was no way to help a teacher who needed access to someone else's class.
- **Teachers** sign in with their ordinary ilmTrack account and get
  [reports](#reports) for their own classes — the same attendance, homework and
  per-student figures the app shows, on a screen big enough to read them, and
  downloadable as CSV.

Read-only apart from the co-teacher link. Built to run locally.

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

5. **Create the report indexes.** Two composite indexes, needed once per
   Firebase project. Reports return `FAILED_PRECONDITION` until they exist.

   ```bash
   gcloud firestore indexes composite create \
     --project="$NEXT_PUBLIC_FIREBASE_PROJECT_ID" \
     --collection-group=attendance \
     --field-config=field-path=classId,order=ascending \
     --field-config=field-path=date,order=ascending

   gcloud firestore indexes composite create \
     --project="$NEXT_PUBLIC_FIREBASE_PROJECT_ID" \
     --collection-group=homework \
     --field-config=field-path=classId,order=ascending \
     --field-config=field-path=createdAt,order=ascending
   ```

   Building is online — the mobile app keeps working throughout. Wait for
   `state: READY`:

   ```bash
   gcloud firestore indexes composite list --project="$NEXT_PUBLIC_FIREBASE_PROJECT_ID"
   ```

   Use `gcloud`, not `firebase deploy --only firestore:indexes`: that command
   is declarative against `../ilmTrack/firestore.indexes.json`, and will offer
   to delete any index missing from it. Not needed for the emulator, which
   does not enforce composite indexes.

6. **Run**

   ```bash
   npm run dev     # http://localhost:3000
   ```

## Access control

`resolveRole()` in [`src/lib/auth/session.ts`](src/lib/auth/session.ts) is the
one gate. The sign-in route calls it to decide whether to mint a cookie, and
every later request calls it again through `getSession()`, so the two can never
drift apart. There are two ways in:

| Role | Requires | Effect |
| --- | --- | --- |
| `super-admin` | Email in `ADMIN_EMAILS` **and** a `role` custom claim from `npm run grant` | Both checked on every request: removing an email locks that person out immediately, and the claim takes effect at next sign-in |
| `teacher` | A **verified** email **and** `users/{uid}.role == 'teacher'` in Firestore | No per-teacher setup. Access appears and disappears with their ilmTrack account |

The teacher gate reads the token's `email_verified` claim rather than the user
document's `emailVerified` field: the app only stamps that field on the first
verified *login*, so a teacher who verified but has not reopened the app since
would be wrongly turned away.

Permissions live in one table, [`src/lib/auth/roles.ts`](src/lib/auth/roles.ts):

```ts
const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  'super-admin': ['classes:read', 'classes:linkTeacher', 'teachers:read', 'reports:read'],
  'teacher':     ['reports:read'],
};
```

Every page calls `requirePermission(...)` and every route handler calls
`requireApiPermission(...)`, and UI affordances render behind the same `can()`
check — so a button and its endpoint can never disagree. The shell layout is
the one exception: it calls `requireSession()`, because any valid role may
render a header, and the pages inside it still guard themselves.

*Which* classes a role may see is a separate question, answered only by
`canSeeClass()` in [`src/lib/data/classes.ts`](src/lib/data/classes.ts). A
teacher sees a class if they own it, or if they are a co-teacher whose invite
is `accepted`. That reads the class document rather than
`users/{uid}.adminClassIds`, so a drifted array cannot grant access it
shouldn't.

**To add a role later** (say an organization owner who sees only their own
org's classes):

1. Add it to `ROLES` and give it a permission list in `roles.ts`.
2. Add its branch to `canSeeClass()` — the single place class visibility is
   decided, used by the class list, the detail page and every report.
3. Give those users whatever `resolveRole()` looks for.

## Reports

`/reports?classId=…&from=YYYY-MM-DD&to=YYYY-MM-DD` renders one of three
reports — Attendance, Homework, or a per-student Class summary — and offers
the same rows as a CSV download from
`GET /api/reports/:classId/:kind`.

The arithmetic in [`src/lib/reports/rows.ts`](src/lib/reports/rows.ts) is a
hand-port of [`reportUtils.ts`](../ilmTrack/src/utils/reportUtils.ts), kept
identical on purpose: a teacher comparing this console against the app's own
report should see the same numbers. (It is hand-copied for the same reason
`src/types/` is — the two apps use different Firebase SDKs, so their
`Timestamp` classes are different types.) Note that attendance is filtered on
`date` and homework on `createdAt`; that asymmetry comes from the app.

**All state lives in the URL.** The header class picker writes only `classId`
and copies every other parameter through; the date form writes only `from` and
`to` and copies `classId`. So switching class cannot disturb the dates, and
changing dates cannot disturb the class — structurally, not by convention.
The page canonicalizes the URL on first visit so the dates are always spelled
out rather than implied.

The range defaults to the **last month**, and is capped at `MAX_RANGE_DAYS`.

### Report indexes

Both report queries filter a date range, and a Firestore query may combine any
number of equality filters without a composite index but a *range* filter
always needs one. Hence the two created in
[setup](#setup):

```
attendance:  classId ASC, date ASC
homework:    classId ASC, createdAt ASC
```

They exist only for this console, and the mobile app will never use them: its
security rules require every list query to carry an identity filter
statically, so its equivalents are `classId + invitedTeacherIds + date`, which
already have indexes in `../ilmTrack/firestore.indexes.json`. Nothing in the
app needs to change for reports to work here.

They live outside that file, which is a deliberate trade — this console's
indexes are not the app repo's business. Note that file is already not a full
picture of the project: several indexes the app itself relies on (including
`homework: studentId, teacherId, createdAt`) exist only in the project, so a
`firebase deploy --only firestore:indexes` would offer to delete those too.

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

Access control, class scoping and the report data layer are covered against
the Firestore emulator; date-range parsing, CSV escaping and the summary
arithmetic are pure and need no emulator. Nothing here touches production.

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
