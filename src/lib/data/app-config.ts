import 'server-only';

import { cache } from 'react';
import { getAdminDb } from '@/lib/firebase-admin';

/**
 * Feature flags, from the same config/app document the mobile app's
 * VersionGate already reads. No new infrastructure, and it can be flipped from
 * the Firebase console without a deploy.
 *
 * These gate *visibility*, never authority. Every flagged surface is also
 * behind requirePermission()/requireApiPermission() and canSeeClass(), so
 * turning a flag on cannot grant anyone access they did not already have, and
 * turning it off is a rollout control rather than a security boundary — a
 * hidden button stops nobody calling the endpoint directly.
 *
 * They fail CLOSED, which is the opposite of the version gate: a config read
 * that fails there must not brick the app, whereas here it should simply leave
 * a new feature switched off.
 */
export interface Features {
  /** Lets org admins (not super-admins) move a student between their classes. */
  orgAdminTransfer: boolean;
}

const DEFAULTS: Features = {
  orgAdminTransfer: false,
};

/** Cached per request, so a page reading it twice costs one read. */
export const features = cache(async function features(): Promise<Features> {
  try {
    const snap = await getAdminDb().collection('config').doc('app').get();
    const raw = (snap.data()?.features ?? {}) as Partial<Record<keyof Features, unknown>>;

    return {
      orgAdminTransfer: raw.orgAdminTransfer === true,
    };
  } catch (error) {
    console.error('Could not read feature flags; falling back to defaults.', error);
    return DEFAULTS;
  }
});
