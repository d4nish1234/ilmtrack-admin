'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { clientAuth } from '@/lib/firebase-client';

/**
 * Google sign-in. Mints the same session cookie as the password form, through
 * the same endpoint, so resolveRole() remains the only thing deciding who gets
 * in — this changes *how you prove you are you*, not what that earns you.
 *
 * Shown on the main sign-in page as well as /login/admin. A teacher who picks
 * it either lands on their existing account (if it was created with Google) or
 * is told to use their password, which is a clearer outcome than hiding the
 * option and is why it is no longer admin-only.
 *
 * The reason it exists is the second factor: this console's only defence was a
 * password, and an account that can read every class and move students
 * deserves better. Google carries whatever 2FA is already on the account, with
 * no Identity Platform upgrade and no change to the mobile app.
 */
export default function GoogleSignIn() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSignIn() {
    setBusy(true);
    setError(null);

    try {
      const provider = new GoogleAuthProvider();
      // Always ask which account, rather than silently reusing the one the
      // browser happens to be signed into.
      provider.setCustomParameters({ prompt: 'select_account' });

      const credential = await signInWithPopup(clientAuth, provider);
      const idToken = await credential.user.getIdToken();

      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });

      if (!response.ok) {
        // Not allowed in — don't leave a half-signed-in client session behind.
        await signOut(clientAuth);
        const { error: message } = await response.json();
        setError(message ?? 'Sign-in failed.');
        return;
      }

      const { redirectTo } = await response.json();
      router.replace(redirectTo ?? '/');
      router.refresh();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return; // They changed their mind; not an error worth showing.
      }
      setError(
        code === 'auth/account-exists-with-different-credential'
          ? 'An ilmTrack account already uses this address with a password. Sign in at /login instead.'
          : code === 'auth/operation-not-allowed'
            ? 'Google sign-in is not enabled for this Firebase project yet.'
            : 'Sign-in failed. Check your connection and try again.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={handleSignIn}
        disabled={busy}
        className="w-full rounded-md border border-strong bg-surface px-3 py-2 text-sm font-medium disabled:opacity-50"
      >
        {busy ? 'Signing in…' : 'Continue with Google'}
      </button>
      {error && <p className="text-sm text-danger-fg">{error}</p>}
    </div>
  );
}
