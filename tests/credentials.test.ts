/**
 * Resolving the service account credential.
 *
 * This is the piece that differs between a laptop (a file on disk) and a
 * hosted deploy (an environment variable), so it is the piece most likely to
 * be wrong only in production. No emulator, no Firebase app — the function
 * just resolves and validates the JSON.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadServiceAccount } from '@/lib/firebase-admin';

const KEY = {
  type: 'service_account',
  project_id: 'ilmtrack-test',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIfake\n-----END PRIVATE KEY-----\n',
  client_email: 'admin@ilmtrack-test.iam.gserviceaccount.com',
};

const saved = {
  json: process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
  path: process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
};

beforeEach(() => {
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  delete process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
});

afterEach(() => {
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = saved.json;
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH = saved.path;
  if (saved.json === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (saved.path === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
});

function writeKey(contents: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'ilmtrack-')), 'key.json');
  writeFileSync(file, contents);
  return file;
}

describe('loadServiceAccount', () => {
  it('reads raw JSON from the environment', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify(KEY);
    expect(loadServiceAccount().client_email).toBe(KEY.client_email);
  });

  it('keeps the newlines in private_key intact', () => {
    // If these collapse, signing fails at request time with an opaque error.
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify(KEY);
    expect(loadServiceAccount().private_key).toBe(KEY.private_key);
    expect(loadServiceAccount().private_key.split('\n')).toHaveLength(4);
  });

  it('accepts base64, for dashboards that mangle multi-line values', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = Buffer.from(JSON.stringify(KEY)).toString('base64');
    expect(loadServiceAccount().private_key).toBe(KEY.private_key);
  });

  it('tolerates surrounding whitespace from a copy-paste', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = `\n  ${JSON.stringify(KEY)}  \n`;
    expect(loadServiceAccount().project_id).toBe('ilmtrack-test');
  });

  it('reads a file when only a path is set', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH = writeKey(JSON.stringify(KEY));
    expect(loadServiceAccount().project_id).toBe('ilmtrack-test');
  });

  it('prefers the environment variable over a path', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ ...KEY, project_id: 'from-env' });
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH = writeKey(JSON.stringify(KEY));
    expect(loadServiceAccount().project_id).toBe('from-env');
  });

  it('names both options when neither is set', () => {
    expect(() => loadServiceAccount()).toThrow(/FIREBASE_SERVICE_ACCOUNT_JSON/);
    expect(() => loadServiceAccount()).toThrow(/FIREBASE_SERVICE_ACCOUNT_PATH/);
  });

  it('says which source was bad when the JSON will not parse', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{ not json';
    expect(() => loadServiceAccount()).toThrow(/FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON/);
  });

  it('reports a missing file by path', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH = '/no/such/key.json';
    expect(() => loadServiceAccount()).toThrow(/Could not read the service account key/);
  });

  it('catches the web config being pasted instead of the service account', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      apiKey: 'AIza…',
      projectId: 'ilmtrack-f6c8c',
      appId: '1:123:web:abc',
    });
    expect(() => loadServiceAccount()).toThrow(/missing project_id, private_key, client_email/);
  });
});
