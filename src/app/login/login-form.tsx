'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { clientAuth } from '@/lib/firebase-client';

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const credential = await signInWithEmailAndPassword(clientAuth, email, password);
      const idToken = await credential.user.getIdToken();

      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });

      if (!response.ok) {
        // Not an admin — don't leave a half-signed-in client session behind.
        await signOut(clientAuth);
        const { error: message } = await response.json();
        setError(message ?? 'Sign-in failed.');
        return;
      }

      router.replace('/classes');
      router.refresh();
    } catch (err) {
      const code = (err as { code?: string }).code;
      setError(
        code === 'auth/invalid-credential' ||
          code === 'auth/wrong-password' ||
          code === 'auth/user-not-found'
          ? 'Incorrect email or password.'
          : 'Sign-in failed. Check your connection and try again.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <input
        type="email"
        required
        autoComplete="username"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded-md border border-strong bg-surface px-3 py-2 text-sm"
      />
      <input
        type="password"
        required
        autoComplete="current-password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full rounded-md border border-strong bg-surface px-3 py-2 text-sm"
      />
      {error && <p className="text-sm text-danger-fg">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-accent-solid px-3 py-2 text-sm font-medium text-accent-solid-fg disabled:opacity-50"
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
