import Link from 'next/link';
import { requirePermission } from '@/lib/auth/session';
import SignOutButton from './sign-out-button';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePermission('classes:read');

  return (
    <div className="min-h-screen">
      <header className="border-b border-subtle bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link href="/classes" className="font-semibold">
            ilmTrack Admin
          </Link>
          <div className="flex items-center gap-3 text-sm text-muted">
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
