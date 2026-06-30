import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { createGitRemoteProvider } from './git-provider.js';

export interface StoredGitHubToken {
  accessToken: string;
  username?: string;
  avatarUrl?: string;
  scopes?: string[];
  savedAt: number;
  providerUrl?: string | undefined;
}

export interface GitHubTokensFile {
  token?: StoredGitHubToken;
}

const EMPTY: GitHubTokensFile = {};

function tokensFile(dataDir: string): string {
  return path.join(dataDir, 'github-tokens.json');
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

export function sanitizeTokensFile(raw: unknown): GitHubTokensFile {
  if (!isPlainObject(raw)) return {};
  const tok = sanitizeToken(raw.token);
  return tok ? { token: tok } : {};
}

function sanitizeToken(raw: unknown): StoredGitHubToken | null {
  if (!isPlainObject(raw)) return null;
  const accessToken =
    typeof raw.accessToken === 'string' ? raw.accessToken.trim() : '';
  if (!accessToken) return null;
  const username =
    typeof raw.username === 'string' ? raw.username.trim() : undefined;
  const avatarUrl =
    typeof raw.avatarUrl === 'string' ? raw.avatarUrl.trim() : undefined;
  const scopes =
    Array.isArray(raw.scopes) && raw.scopes.every((s) => typeof s === 'string')
      ? (raw.scopes as string[])
      : undefined;
  const savedAt =
    typeof raw.savedAt === 'number' && Number.isFinite(raw.savedAt)
      ? raw.savedAt
      : Date.now();
  const providerUrl =
    typeof raw.providerUrl === 'string' ? raw.providerUrl.trim() : undefined;
  const out: StoredGitHubToken = { accessToken, savedAt };
  if (username) out.username = username;
  if (avatarUrl) out.avatarUrl = avatarUrl;
  if (scopes) out.scopes = scopes;
  if (providerUrl) out.providerUrl = providerUrl;
  return out;
}

export async function readTokensFile(dataDir: string): Promise<GitHubTokensFile> {
  try {
    const raw = await readFile(tokensFile(dataDir), 'utf8');
    return sanitizeTokensFile(JSON.parse(raw));
  } catch (err: unknown) {
    const e = err as { code?: string; name?: string; message?: string };
    if (e.code === 'ENOENT') return { ...EMPTY };
    if (e.name === 'SyntaxError') {
      console.error('[github-tokens] Corrupted JSON, returning empty:', e.message);
      return { ...EMPTY };
    }
    throw err;
  }
}

const writeLocks = new Map<string, Promise<unknown>>();

async function withLock<T>(dataDir: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(dataDir) ?? Promise.resolve();
  const task = prev.catch(() => {}).then(fn);
  writeLocks.set(dataDir, task);
  try {
    return await task;
  } finally {
    if (writeLocks.get(dataDir) === task) writeLocks.delete(dataDir);
  }
}

async function writeTokensFile(
  dataDir: string,
  next: GitHubTokensFile,
): Promise<GitHubTokensFile> {
  const file = tokensFile(dataDir);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.' + randomBytes(4).toString('hex') + '.tmp';
  await writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
  await rename(tmp, file);
  try {
    await chmod(file, 0o600);
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code !== 'ENOTSUP' && e.code !== 'EPERM') {
      console.warn(
        '[github-tokens] could not chmod 0600',
        file,
        e.message ?? err,
      );
    }
  }
  return next;
}

export async function getGitHubToken(
  dataDir: string,
): Promise<StoredGitHubToken | null> {
  const file = await readTokensFile(dataDir);
  return file.token ?? null;
}

export async function setGitHubToken(
  dataDir: string,
  token: StoredGitHubToken,
): Promise<void> {
  await withLock(dataDir, async () => {
    await writeTokensFile(dataDir, { token });
  });
}

export async function clearGitHubToken(dataDir: string): Promise<void> {
  await withLock(dataDir, async () => {
    const file = await readTokensFile(dataDir);
    if (!file.token) return;
    await writeTokensFile(dataDir, {});
  });
}

/**
 * Legacy wrapper — delegates to GitRemoteProvider.fetchInit().
 * Kept for callers that haven't migrated to the provider yet.
 */
export function customProviderFetchInit(providerUrl: string | undefined): RequestInit {
  return createGitRemoteProvider(providerUrl).fetchInit();
}

export interface CreateRepoParams {
  accessToken: string;
  name: string;
  private?: boolean;
  owner?: string;
  ownerType?: 'user' | 'organization';
  providerUrl?: string | undefined;
}

export async function createGitHubRepository(params: CreateRepoParams): Promise<{
  fullName: string;
  cloneUrl: string;
  private: boolean;
  fork: boolean;
  description?: string | null;
}> {
  const { accessToken, name, private: isPrivate, owner, ownerType, providerUrl } = params;
  if (!name || !name.trim()) {
    throw new Error('repository name is required');
  }

  console.log('[createGitHubRepository] Starting repo creation with params:', {
    name,
    isPrivate,
    owner,
    ownerType,
    providerUrl,
    tokenLength: accessToken?.length,
    tokenPreview: accessToken ? `${accessToken.substring(0, 4)}...` : null
  });

  const provider = createGitRemoteProvider(providerUrl);

  let url = provider.apiUrl('/user/repos');
  if (owner && owner.trim() && ownerType === 'organization') {
    url = provider.apiUrl(`/orgs/${owner.trim()}/repos`);
  }

  const reqHeaders: Record<string, string> = {
    ...provider.apiHeaders(accessToken),
    'Content-Type': 'application/json',
  };

  console.log('[createGitHubRepository] Fetch request configuration:', {
    url,
    headers: {
      ...reqHeaders,
      Authorization: reqHeaders.Authorization ? `${reqHeaders.Authorization.substring(0, 15)}...` : undefined
    }
  });

  const createResp = await fetch(url, {
    method: 'POST',
    headers: reqHeaders,
    body: JSON.stringify({
      name: name.trim(),
      private: !!isPrivate,
    }),
    ...provider.fetchInit(),
  });

  console.log('[createGitHubRepository] Fetch response status:', createResp.status, createResp.statusText);

  if (!createResp.ok) {
    let errMsg = createResp.statusText;
    let rawBody = '';
    try {
      rawBody = await createResp.text();
      console.log('[createGitHubRepository] Failure body:', rawBody);
      const body = JSON.parse(rawBody);
      if (body?.message) errMsg = body.message;
    } catch (err) {
      console.log('[createGitHubRepository] Could not read/parse error body:', err, '; raw body was:', rawBody);
    }
    throw new Error(`Failed to create repository: ${errMsg}`);
  }

  const repo = await createResp.json() as any;
  console.log('[createGitHubRepository] Repo successfully created:', repo.full_name || repo.name);
  return {
    fullName: repo.full_name || repo.name,
    cloneUrl: repo.clone_url,
    private: repo.private,
    fork: repo.fork,
    description: repo.description,
  };
}

