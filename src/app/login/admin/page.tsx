import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { landingPath } from '@/lib/auth/roles';
import GoogleSignIn from '../google-sign-in';

/**
 * Administrator sign-in, via Google.
 *
 * A Google-only entry point, kept as a bookmarkable route now that the same
 * button also appears on /login. Nothing here is privileged: authorization is
 * unchanged, and resolveRole() still decides, so signing in on this page
 * grants exactly what signing in on /login would.
 */
export default async function AdminLoginPage() {
  const existing = await getSession();
  if (existing) redirect(landingPath(existing.role));

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold">ilmTrack Admin</h1>
        <p className="mt-1 mb-6 text-sm text-muted">
          Administrator sign-in. Teachers should use the{' '}
          <a href="/login" className="underline">
            normal sign-in page
          </a>
          .
        </p>
        <GoogleSignIn />
      </div>
    </main>
  );
}
