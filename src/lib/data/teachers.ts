import 'server-only';

import { getAdminDb } from '@/lib/firebase-admin';
import type { User } from '@/types';

export interface TeacherOption {
  uid: string;
  name: string;
  email: string;
}

/** All teacher accounts, for the link picker. */
export async function listTeachers(): Promise<TeacherOption[]> {
  const snap = await getAdminDb().collection('users').where('role', '==', 'teacher').get();

  return snap.docs
    .map((d) => {
      const u = d.data() as User;
      return {
        uid: d.id,
        name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email,
        email: u.email,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
