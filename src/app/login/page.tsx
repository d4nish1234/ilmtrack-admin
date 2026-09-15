import { getSession } from '@/lib/auth/session';
import { redirect } from 'next/navigation';
import LoginForm from './login-form';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getSession()) redirect('/classes');
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold">ilmTrack Admin</h1>
        <p className="mt-1 mb-6 text-sm text-muted">
          Sign in with your ilmTrack account.
        </p>
        {error === 'forbidden' && (
          <p className="mb-4 rounded-md bg-warn-bg p-3 text-sm text-warn-fg">
            Your account does not have access to that page.
          </p>
        )}
        <LoginForm />
      </div>
    </main>
  );
}
