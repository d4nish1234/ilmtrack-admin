import Link from 'next/link';
import { can, landingPath } from '@/lib/auth/roles';
import { requireSession } from '@/lib/auth/session';
import { listVisibleClasses } from '@/lib/data/classes';
import ClassSwitcher from './class-switcher';
import SignOutButton from './sign-out-button';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Any valid role may render the shell; each page inside guards what it
  // actually shows with its own requirePermission().
  const session = await requireSession();

  // Scoped by canSeeClass(), so a teacher's menu holds only their own classes.
  // For a super-admin this is a collection scan on every page — acceptable for
  // an internal console, and the reason the picker is hidden when there is
  // nothing to pick.
  const classes = can(session.role, 'reports:read') ? await listVisibleClasses(session) : [];

  return (
    <div className="min-h-screen">
      <header className="border-b border-subtle bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div className="flex items-center gap-4">
            <Link href={landingPath(session.role)} className="font-semibold">
              ilmTrack Admin
            </Link>
            <nav className="flex items-center gap-3 text-sm">
              {can(session.role, 'classes:read') && (
                <Link href="/classes" className="text-muted hover:underline">
                  Classes
                </Link>
              )}
              {can(session.role, 'reports:read') && (
                <Link href="/reports" className="text-muted hover:underline">
                  Reports
                </Link>
              )}
            </nav>
          </div>

          <div className="flex items-center gap-3 text-sm text-muted">
            {classes.length > 0 && <ClassSwitcher classes={classes} />}
            <span>
              {session.email}
              <span className="ml-2 rounded bg-surface-muted px-1.5 py-0.5 text-xs text-muted">
                {session.role}
              </span>
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
