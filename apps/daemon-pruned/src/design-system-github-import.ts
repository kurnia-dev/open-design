import { execFile } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  LocalDesignSystemImportError,
  type LocalDesignSystemImportOptions,
  type LocalDesignSystemImportResult,
  importLocalDesignSystemProject,
  importLocalDesignSystemProjectAsReference,
} from './design-system-import.js';
import { createGitRemoteProvider } from './git-provider.js';

const execFileAsync = promisify(execFile);

/**
 * Options for cloning and importing a Git or GitHub design system repository.
 */
export type GitHubDesignSystemImportOptions = Pick<
  LocalDesignSystemImportOptions,
  | 'craftApplies'
  | 'importMode'
  | 'name'
  | 'now'
  | 'reservedIds'
  | 'projectsRoot'
  | 'onProgress'
> & {
  /** Optional branch name to clone/check out. */
  branch?: string;
  /** Optional override for the git binary executable path. */
  gitBin?: string;
  /** Optional GitHub OAuth access token for private repository clone authentication. */
  githubToken?: string;
  /** If true, imports the repository as reference only. */
  isReferenceOnly?: boolean;
  /** Optional base URL of the remote Git provider (e.g. self-hosted Gitea). */
  providerUrl?: string | undefined;
};

export type ParsedGitHubRepoUrl = {
  cloneUrl: string;
  owner: string;
  repo: string;
};

type ExecGitResult = {
  stdout: string | Buffer;
  stderr: string | Buffer;
};

export function parseGitRepoUrl(input: string): { cloneUrl: string; repo: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new LocalDesignSystemImportError('BAD_REQUEST', 'Git URL is required');
  }
  let repoName = 'git-repo';
  let cleanUrl = trimmed.replace(/\/+$/, '');
  const gitSuffixRegex = /\/([^/]+?)(?:\.git)?$/i;
  const match = cleanUrl.match(gitSuffixRegex);
  if (match && match[1]) {
    repoName = match[1];
  }
  return {
    cloneUrl: trimmed,
    repo: repoName,
  };
}

export async function importGitHubDesignSystemProject(
  gitUrl: string,
  tmpRoot: string,
  userDesignSystemsRoot: string,
  options: GitHubDesignSystemImportOptions = {},
): Promise<LocalDesignSystemImportResult> {
  // Try GitHub-specific parsing first for structured owner/repo metadata.
  // Falls back to the generic parser for non-GitHub URLs.
  let parsedGitHub: ParsedGitHubRepoUrl | null = null;
  try {
    parsedGitHub = parseGitHubRepoUrl(gitUrl);
  } catch {
    // Not a github.com URL — use generic path
  }

  const parsedGeneric = parsedGitHub ?? parseGitRepoUrl(gitUrl);
  const sourceType: 'github' | 'git' = parsedGitHub ? 'github' : 'git';
  const repoName = parsedGitHub?.repo ?? parsedGeneric.repo;
  const ownerPrefix = parsedGitHub ? `${parsedGitHub.owner}-` : '';

  const importedAt = (options.now ?? new Date()).toISOString();
  const gitBin = options.gitBin ?? 'git';
  const cloneArgs = ['clone', '--depth', '1'];
  const branch = cleanBranch(options.branch);
  if (branch) cloneArgs.push('--branch', branch);

  const cloneRoot = path.join(
    tmpRoot,
    parsedGitHub ? 'github-design-system-imports' : 'git-design-system-imports',
  );
  const cloneDirName = `${ownerPrefix}${repoName}-${importedAt.replace(/[^0-9a-z]/gi, '')}`;

  const isGitHub = !!parsedGitHub;
  let providerUrl = options.providerUrl;
  if (!providerUrl) {
    if (!isGitHub) {
      try {
        const parsedUrl = new URL(gitUrl);
        providerUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;
      } catch {
        // ignore
      }
    }
  }
  const provider = createGitRemoteProvider(providerUrl);

  // Build authenticated clone URL when a token is provided
  let cloneUrl = parsedGeneric.cloneUrl;
  if (options.githubToken) {
    cloneUrl = provider.authenticatedCloneUrl(cloneUrl, options.githubToken);
  }
  cloneArgs.push(cloneUrl);

  await mkdir(cloneRoot, { recursive: true });
  const cloneDir = path.join(cloneRoot, cloneDirName);
  cloneArgs.push(cloneDir);

  try {
    options.onProgress?.('Cloning Git repository...');
    await execGit(gitBin, cloneArgs, undefined, 120_000);
    const detectedBranch = await readGitStdout(gitBin, ['-C', cloneDir, 'rev-parse', '--abbrev-ref', 'HEAD']);
    const sourceBranch = branch ?? normalizeDetachedBranch(detectedBranch);
    const importFn = options.isReferenceOnly
      ? importLocalDesignSystemProjectAsReference
      : importLocalDesignSystemProject;
    const result = await importFn(cloneDir, userDesignSystemsRoot, {
      now: new Date(importedAt),
      fallbackName: repoName,
      ...(options.name ? { name: options.name } : {}),
      ...(options.reservedIds ? { reservedIds: options.reservedIds } : {}),
      ...(options.importMode ? { importMode: options.importMode } : {}),
      ...(options.craftApplies ? { craftApplies: options.craftApplies } : {}),
      projectsRoot: options.projectsRoot,
      onProgress: options.onProgress,
      source: {
        type: sourceType,
        url: parsedGeneric.cloneUrl,
        ...(sourceBranch ? { branch: sourceBranch } : {}),
      },
    });
    await rm(cloneDir, { recursive: true, force: true });
    return result;
  } catch (err) {
    await rm(cloneDir, { recursive: true, force: true });
    if (err instanceof LocalDesignSystemImportError) throw err;
    throw new LocalDesignSystemImportError(
      'BAD_REQUEST',
      parsedGitHub
        ? `could not import public GitHub repository: ${formatGitError(err)}`
        : `could not import Git repository: ${formatGitError(err)}`,
    );
  }
}

export function parseGitHubRepoUrl(input: string): ParsedGitHubRepoUrl {
  const clean = input.trim();
  const ssh = /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:[#?].*)?$/.exec(clean);
  if (ssh?.[1] && ssh[2]) {
    const owner = ssh[1];
    const repo = ssh[2].replace(/\.git$/i, '');
    return {
      owner,
      repo,
      cloneUrl: `https://github.com/${owner}/${repo}.git`,
    };
  }

  let url: URL;
  try {
    url = new URL(clean);
  } catch {
    throw new LocalDesignSystemImportError('BAD_REQUEST', 'GitHub URL must be a valid github.com URL');
  }

  const host = url.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') {
    throw new LocalDesignSystemImportError('BAD_REQUEST', 'only github.com repositories are supported');
  }

  const parts = url.pathname.split('/').filter(Boolean);
  const owner = parts[0];
  const rawRepo = parts[1];
  if (!owner || !rawRepo || parts.length > 2) {
    throw new LocalDesignSystemImportError('BAD_REQUEST', 'GitHub URL must point to a repository root');
  }

  const repo = rawRepo.replace(/\.git$/i, '');
  if (!isGitHubPathSegment(owner) || !isGitHubPathSegment(repo)) {
    throw new LocalDesignSystemImportError('BAD_REQUEST', 'GitHub repository owner/name contains unsupported characters');
  }

  return {
    owner,
    repo,
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
  };
}

function cleanBranch(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (!/^[A-Za-z0-9._/-]+$/.test(trimmed) || trimmed.includes('..') || trimmed.startsWith('/')) {
    throw new LocalDesignSystemImportError('BAD_REQUEST', 'GitHub branch contains unsupported characters');
  }
  return trimmed;
}

function normalizeDetachedBranch(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'HEAD') return undefined;
  return trimmed;
}

function isGitHubPathSegment(value: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(value) && !value.startsWith('.') && !value.endsWith('.');
}

async function readGitStdout(gitBin: string, args: string[]): Promise<string> {
  const result = await execGit(gitBin, args, undefined, 20_000);
  return String(result.stdout).trim();
}

async function execGit(
  gitBin: string,
  args: string[],
  cwd: string | undefined,
  timeout: number,
): Promise<ExecGitResult> {
  return await execFileAsync(gitBin, args, {
    cwd,
    timeout,
    maxBuffer: 1024 * 1024,
  });
}

function formatGitError(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const stderr = (err as { stderr?: unknown }).stderr;
    if (typeof stderr === 'string' && stderr.trim()) return stderr.trim().split('\n').slice(-1)[0] ?? stderr.trim();
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  return String(err);
}
