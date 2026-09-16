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
