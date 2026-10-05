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

/**
 * A school or group that owns classes. Introduced so a class owner can grant
 * administrative rights over several classes at once.
 *
 * Membership lives here and NOT in custom claims: claims cap at ~1000 bytes
 * and refresh only with the token (roughly hourly), so revoking an admin who
 * can move students would lag by up to an hour. Delayed grants are an
 * annoyance; delayed revocation is a hole.
 */
export type OrgRole = 'owner' | 'admin';

export interface OrgMember {
  userId: string;
  email: string;
  role: OrgRole;
}

export interface Organization {
  id: string;
  name: string;
  members: OrgMember[];
  /** Derived from members, mirroring adminUserIds on a class. */
  memberUserIds: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Class {
  id: string;
  name: string;
  description?: string;
  /** Owner uid. */
  teacherId: string;
  /** The organization this class belongs to, if any. Standalone classes have none. */
  orgId?: string;
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

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

export interface Attendance {
  id: string;
  studentId: string;
  classId: string;
  teacherId: string;
  parentUserIds?: string[];
  /** Owner + accepted co-teachers. Denormalized to satisfy security rules. */
  invitedTeacherIds?: string[];
  date: Timestamp;
  status: AttendanceStatus;
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type HomeworkStatus = 'assigned' | 'completed' | 'incomplete' | 'late';

/** Parent-friendly evaluation rating, 1–5 stars. */
export type HomeworkEvaluation = 1 | 2 | 3 | 4 | 5;

export const EVALUATION_LABELS: Record<HomeworkEvaluation, string> = {
  1: 'Needs More Practice',
  2: 'Making Progress',
  3: 'Good Effort',
  4: 'Great Work',
  5: 'Excellent',
};

export interface Homework {
  id: string;
  studentId: string;
  classId: string;
  teacherId: string;
  parentUserIds?: string[];
  invitedTeacherIds?: string[];
  title: string;
  description?: string;
  dueDate?: Timestamp;
  status: HomeworkStatus;
  evaluation?: HomeworkEvaluation;
  evaluationNotes?: string;
  completedAt?: Timestamp;
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
