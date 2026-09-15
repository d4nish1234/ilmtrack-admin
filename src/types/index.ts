/**
 * Firestore document shapes, mirrored from ../ilmTrack/src/types/.
 *
 * Hand-copied rather than imported: the mobile app uses the Firebase *client*
 * SDK and this app uses firebase-admin, and their Timestamp classes are
 * different types. Keep these in sync by hand when the app's types change.
 */
import { Timestamp } from 'firebase-admin/firestore';

export type UserRole = 'teacher' | 'parent';

export interface User {
  uid: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  emailVerified?: boolean;
  classIds?: string[];
  /** Classes where this user is a co-teacher (not the owner). */
  adminClassIds?: string[];
  studentIds?: string[];
}

export type AdminInviteStatus = 'pending' | 'accepted';

/** A co-teacher entry on a class. "Admin" is the app's word for co-teacher. */
export interface Admin {
  email: string;
  userId?: string;
  inviteStatus: AdminInviteStatus;
  inviteSentAt: Timestamp;
  acceptedAt?: Timestamp;
}

export interface Class {
  id: string;
  name: string;
  description?: string;
  /** Owner uid. */
  teacherId: string;
  admins: Admin[];
  studentCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type InviteStatus = 'pending' | 'sent' | 'accepted';

export interface Parent {
  firstName: string;
  lastName: string;
  email: string;
  userId?: string;
  inviteStatus: InviteStatus;
  inviteSentAt?: Timestamp;
}

export interface Student {
  id: string;
  firstName: string;
  lastName: string;
  classId: string;
  teacherId: string;
  parents: Parent[];
  parentUserIds?: string[];
  /** Owner + accepted co-teachers. Denormalized to satisfy security rules. */
  invitedTeacherIds?: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
