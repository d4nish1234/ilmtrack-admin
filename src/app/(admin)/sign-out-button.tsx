'use client';

import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { clientAuth } from '@/lib/firebase-client';

export default function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    await fetch('/api/session', { method: 'DELETE' });
    await signOut(clientAuth).catch(() => {});
    router.replace('/login');
    router.refresh();
  }

  return (
    <button onClick={handleSignOut} className="text-muted underline hover:text-body">
      Sign out
    </button>
  );
}
