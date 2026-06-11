import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearGitHubToken,
  getGitHubToken,
  readTokensFile,
  sanitizeTokensFile,
  setGitHubToken,
  type StoredGitHubToken,
} from '../src/github-tokens.js';

const isPosix = process.platform !== 'win32';

describe('github-tokens persistence', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'od-github-tokens-'));
  });

  afterEach(async () => {
    await rm(dataDir, { force: true, recursive: true });
  });

  it('returns null when no file exists', async () => {
    expect(await getGitHubToken(dataDir)).toBeNull();
  });

  it('round-trips a token through set + get', async () => {
    const tok: StoredGitHubToken = {
      accessToken: 'ghp_secretTokenHere',
      username: 'octocat',
      avatarUrl: 'https://github.com/images/error/octocat_happy.gif',
      scopes: ['repo', 'read:user'],
      savedAt: Date.now(),
    };
    await setGitHubToken(dataDir, tok);
    const got = await getGitHubToken(dataDir);
    expect(got).toEqual(tok);
  });

  it('overwrites the previous token rather than appending', async () => {
    const a: StoredGitHubToken = {
      accessToken: 'token-a',
      username: 'user-a',
      savedAt: 1,
    };
    const b: StoredGitHubToken = {
      accessToken: 'token-b',
      username: 'user-b',
      savedAt: 2,
    };
    await setGitHubToken(dataDir, a);
    await setGitHubToken(dataDir, b);
    const got = await getGitHubToken(dataDir);
    expect(got?.accessToken).toBe('token-b');
    expect(got?.username).toBe('user-b');
  });

  it('clearGitHubToken removes the stored token', async () => {
    await setGitHubToken(dataDir, {
      accessToken: 'x',
      savedAt: Date.now(),
    });
    await clearGitHubToken(dataDir);
    expect(await getGitHubToken(dataDir)).toBeNull();
  });

  it('clearGitHubToken is a no-op when nothing is stored', async () => {
    await expect(clearGitHubToken(dataDir)).resolves.not.toThrow();
  });

  it.skipIf(!isPosix)(
    'writes the file as owner-only (mode 0600) on POSIX',
    async () => {
      await setGitHubToken(dataDir, {
        accessToken: 'x',
        savedAt: Date.now(),
      });
      const s = await stat(path.join(dataDir, 'github-tokens.json'));
      expect(s.mode & 0o777).toBe(0o600);
    },
  );

  it('survives a corrupted file by returning empty', async () => {
    await writeFile(
      path.join(dataDir, 'github-tokens.json'),
      '{ corrupted JSON string',
      'utf8',
    );
    expect(await getGitHubToken(dataDir)).toBeNull();
  });

  it('drops malformed entries during read', async () => {
    await writeFile(
      path.join(dataDir, 'github-tokens.json'),
      JSON.stringify({ token: { accessToken: '', savedAt: Date.now() } }),
      'utf8',
    );
    expect(await getGitHubToken(dataDir)).toBeNull();
  });

  it('preserves missing optional fields without injecting undefined', async () => {
    const tok: StoredGitHubToken = {
      accessToken: 'a',
      savedAt: 100,
    };
    await setGitHubToken(dataDir, tok);
    const raw = JSON.parse(
      await readFile(path.join(dataDir, 'github-tokens.json'), 'utf8'),
    );
    expect(raw.token).toEqual({
      accessToken: 'a',
      savedAt: 100,
    });
    expect('username' in raw.token).toBe(false);
    expect('avatarUrl' in raw.token).toBe(false);
    expect('scopes' in raw.token).toBe(false);
  });

  it('serializes concurrent setGitHubToken calls (lock test)', async () => {
    const tokens: StoredGitHubToken[] = Array.from({ length: 8 }, (_, i) => ({
      accessToken: `token-${i}`,
      savedAt: i,
    }));
    await Promise.all(tokens.map((t) => setGitHubToken(dataDir, t)));
    const got = await getGitHubToken(dataDir);
    expect(got).not.toBeNull();
    expect(got!.accessToken).toMatch(/^token-\d$/);
  });
});

describe('readTokensFile', () => {
  it('returns empty when ENOENT', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'od-github-read-'));
    try {
      expect(await readTokensFile(dir)).toEqual({});
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it.skipIf(!isPosix)('rethrows non-ENOENT read errors', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'od-github-perm-'));
    const file = path.join(dir, 'github-tokens.json');
    try {
      await writeFile(file, '{}', 'utf8');
      await chmod(file, 0o000);
      await expect(readTokensFile(dir)).rejects.toThrow();
    } finally {
      await chmod(file, 0o600).catch(() => {});
      await rm(dir, { force: true, recursive: true });
    }
  });
});

describe('sanitizeTokensFile', () => {
  it('drops non-object input', () => {
    expect(sanitizeTokensFile(null)).toEqual({});
    expect(sanitizeTokensFile('string')).toEqual({});
    expect(sanitizeTokensFile(42)).toEqual({});
    expect(sanitizeTokensFile([])).toEqual({});
  });

  it('drops a token with empty accessToken', () => {
    expect(
      sanitizeTokensFile({
        token: { accessToken: '   ', savedAt: Date.now() },
      }),
    ).toEqual({});
  });

  it('coerces savedAt when missing/invalid', () => {
    const before = Date.now();
    const out = sanitizeTokensFile({ token: { accessToken: 'a' } });
    const after = Date.now();
    expect(out.token?.savedAt).toBeGreaterThanOrEqual(before);
    expect(out.token?.savedAt).toBeLessThanOrEqual(after);
  });
});
