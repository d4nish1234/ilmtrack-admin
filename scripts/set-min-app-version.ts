/**
 * Read or set config/app.minSupportedVersion — the minimum ilmTrack build
 * allowed to run. Builds below it get a blocking "Update required" screen.
 *
 *   npm run min-version                 # show current config
 *   npm run min-version -- 1.4          # block anything below 1.4
 *   npm run min-version -- 1.4 --force  # ...even if the App Store lags
 *   npm run min-version -- --clear      # block nobody
 *
 * The app reads this at startup, before signing in, so raising it takes effect
 * without an App Store release. That is what makes a breaking data migration
 * finishable: raise the minimum, and no old client can still read the old shape.
 *
 * Raising this locks people out until they update, so before writing we ask
 * Apple which version is actually live and refuse to set a minimum above it —
 * otherwise there is nothing for a blocked user to update *to*. Apple's lookup
 * is CDN-cached and can lag a few hours behind a release; --force overrides it,
 * as does an unreachable lookup (we warn rather than block on that).
 *
 * There is no equivalent public endpoint for Google Play, so Android is not
 * checked. Confirm the Play rollout yourself.
 */
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

config({ path: '.env.local' });
config({ path: '.env' });

const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!keyPath) {
  console.error('FIREBASE_SERVICE_ACCOUNT_PATH is not set. See .env.example.');
  process.exit(1);
}

initializeApp({
  credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
});

const args = process.argv.slice(2).filter((a) => a !== '--');
const clear = args.includes('--clear');
const force = args.includes('--force');
const version = args.find((a) => /^\d/.test(a));

const IOS_BUNDLE_ID = 'com.danishmahboob.ilmtrack';
/** The storefront the app is published in; `version` is per-country. */
const IOS_COUNTRY = 'us';

/** The version live on the App Store, or null if Apple could not be reached. */
async function liveAppStoreVersion(): Promise<string | null> {
  const url =
    `https://itunes.apple.com/lookup?bundleId=${IOS_BUNDLE_ID}&country=${IOS_COUNTRY}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const body = (await response.json()) as { results?: Array<{ version?: string }> };
    return body.results?.[0]?.version ?? null;
  } catch {
    return null;
  }
}

/** Same ordering as ../ilmTrack/src/utils/appVersion.ts — keep the two in step. */
function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v.trim().split('-')[0].split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [left, right] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const [l, r] = [left[i] ?? 0, right[i] ?? 0];
    if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
}

async function main() {
  const ref = getFirestore().collection('config').doc('app');

  if (!clear && !version) {
    const snap = await ref.get();
    console.log(snap.exists ? snap.data() : '(config/app does not exist yet — nobody is blocked)');
    process.exit(0);
  }

  if (!clear && version && !/^\d+(\.\d+)*$/.test(version)) {
    console.error(`"${version}" is not a plain numeric version like 1.4 or 1.4.0.`);
    process.exit(1);
  }

  if (!clear && version && !force) {
    const live = await liveAppStoreVersion();
    if (live === null) {
      // Nothing is written, so nobody is blocked and the app is unaffected.
      // Refusing is the safe direction here: writing a minimum we could not
      // verify is what risks locking users out.
      console.error(
        'Could not reach the App Store to confirm which version is live, so ' +
          'nothing was changed — no user is blocked and the app is unaffected.\n' +
          'Check the release by hand, then re-run with --force.'
      );
      process.exit(1);
    }
    if (compareVersions(live, version) < 0) {
      console.error(
        `The App Store is serving ${live}, which is below ${version}.\n` +
          `Setting the minimum to ${version} would block every user with no ` +
          `update available. Wait for the release, or pass --force if you are ` +
          `certain it is live and Apple's cache is stale.`
      );
      process.exit(1);
    }
    console.log(`App Store is serving ${live} — ${version} is safe to require.`);
  }

  await ref.set({ minSupportedVersion: clear ? '' : version }, { merge: true });
  console.log(
    clear
      ? 'Cleared — no version is blocked.'
      : `minSupportedVersion = ${version}. Builds below this now show "Update required".`
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
