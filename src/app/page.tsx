import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { landingPath } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

/** Send each role to its own landing page: admins to the class list, teachers to reports. */
export default async function Home() {
  const session = await getSession();
  redirect(session ? landingPath(session.role) : '/login');
}
