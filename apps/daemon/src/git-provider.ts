/**
 * GitRemoteProvider abstraction — encapsulates all GitHub-vs-Gitea (or other
 * GitHub-compatible provider) branching behind a single interface.
 *
 * Every consumer calls `createGitRemoteProvider(providerUrl)` once and then
 * uses the returned object for API URLs, headers, pagination, TLS config, and
 * authenticated clone URL construction. The `providerUrl.includes('github.com')`
 * check happens in exactly ONE place: the factory function below.
 */

import { Agent } from 'undici';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface GitRemoteProvider {
  /** Provider flavour — used for source metadata in manifests. */
  readonly type: 'github' | 'gitea';

  /** Resolve a REST-API path to a full URL.
   *  e.g. `'/user'` → `'https://api.github.com/user'` */
  apiUrl(path: string): string;

  /** Build the standard fetch headers for this provider. */
  apiHeaders(accessToken: string): Record<string, string>;

  /** Extra `RequestInit` fields for `fetch` (e.g. TLS bypass). */
  fetchInit(): RequestInit;

  /** Build a query-string for paginated list endpoints. */
  paginationParams(page: number, limit: number): string;

  /** Return an authenticated HTTPS clone URL for `git clone`. */
  authenticatedCloneUrl(repoUrl: string, accessToken: string): string;

  /** Whether a given git URL belongs to this provider's host. */
  matchesUrl(gitUrl: string): boolean;
}

// ---------------------------------------------------------------------------
// GitHub implementation
// ---------------------------------------------------------------------------

class GitHubProvider implements GitRemoteProvider {
  readonly type = 'github' as const;

  apiUrl(path: string): string {
    return `https://api.github.com${path}`;
  }

  apiHeaders(accessToken: string): Record<string, string> {
    return {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Open-Design-Daemon',
    };
  }

  fetchInit(): RequestInit {
    return {};
  }

  paginationParams(page: number, limit: number): string {
    return `per_page=${limit}&page=${page}&sort=updated`;
  }

  authenticatedCloneUrl(repoUrl: string, accessToken: string): string {
    const clean = repoUrl.trim();
    const gitHost = 'github.com';
    const httpsRegex = /https?:\/\/[^/]*github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i;
    const sshRegex = /git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i;
    const httpsMatch = httpsRegex.exec(clean);
    const sshMatch = sshRegex.exec(clean);

    let owner = '';
    let repo = '';
    if (httpsMatch) {
      owner = httpsMatch[1]!;
      repo = httpsMatch[2]!;
    } else if (sshMatch) {
      owner = sshMatch[1]!;
      repo = sshMatch[2]!;
    } else {
      if (clean.toLowerCase().startsWith('http')) {
        return clean.replace(/^https?:\/\//i, `https://x-access-token:${accessToken}@`);
      }
      return clean;
    }

    return `https://x-access-token:${accessToken}@${gitHost}/${owner}/${repo}.git`;
  }

  matchesUrl(gitUrl: string): boolean {
    try {
      const host = new URL(gitUrl).hostname.toLowerCase();
      return host === 'github.com' || host === 'www.github.com';
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Gitea / custom GitHub-compatible implementation
// ---------------------------------------------------------------------------

class GiteaProvider implements GitRemoteProvider {
  readonly type = 'gitea' as const;
  private readonly baseUrl: string;
  private readonly hostname: string;

  constructor(providerUrl: string) {
    this.baseUrl = providerUrl.endsWith('/')
      ? providerUrl.slice(0, -1)
      : providerUrl;
    try {
      this.hostname = new URL(this.baseUrl).hostname.toLowerCase();
    } catch {
      this.hostname = this.baseUrl;
    }
  }

  apiUrl(path: string): string {
    return `${this.baseUrl}/api/v1${path}`;
  }

  apiHeaders(accessToken: string): Record<string, string> {
    return {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'User-Agent': 'Open-Design-Daemon',
    };
  }

  fetchInit(): RequestInit {
    return {
      // undici Agent is the dispatcher used by Node.js native fetch.
      // Setting rejectUnauthorized:false accepts self-signed certificates
      // commonly found on self-hosted Gitea/Forgejo instances.
      // @ts-expect-error - dispatcher is an undici extension on the fetch API
      dispatcher: new Agent({ connect: { rejectUnauthorized: false } }),
    };
  }

  paginationParams(page: number, limit: number): string {
    return `limit=${limit}&page=${page}`;
  }

  authenticatedCloneUrl(repoUrl: string, accessToken: string): string {
    const clean = repoUrl.trim();
    const gitHost = this.hostname;
    const escapedHost = gitHost.replace(/\./g, '\\.');
    const httpsRegex = new RegExp(`https?://[^/]*${escapedHost}/([^/]+)/([^/]+?)(?:\\.git)?$`, 'i');
    const sshRegex = new RegExp(`git@${escapedHost}:([^/]+)/([^/]+?)(?:\\.git)?$`, 'i');
    const httpsMatch = httpsRegex.exec(clean);
    const sshMatch = sshRegex.exec(clean);

    let owner = '';
    let repo = '';
    if (httpsMatch) {
      owner = httpsMatch[1]!;
      repo = httpsMatch[2]!;
    } else if (sshMatch) {
      owner = sshMatch[1]!;
      repo = sshMatch[2]!;
    } else {
      if (clean.toLowerCase().startsWith('http')) {
        return clean.replace(/^(https?:\/\/)/i, `$1oauth2:${accessToken}@`);
      }
      return clean;
    }

    const protocol = this.baseUrl.startsWith('http:') ? 'http' : 'https';
    return `${protocol}://oauth2:${accessToken}@${gitHost}/${owner}/${repo}.git`;
  }

  matchesUrl(gitUrl: string): boolean {
    try {
      const host = new URL(gitUrl).hostname.toLowerCase();
      return (
        host === this.hostname ||
        host === `www.${this.hostname}` ||
        this.hostname === `www.${host}`
      );
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Factory — the ONLY place that checks 'github.com'
// ---------------------------------------------------------------------------

/**
 * Create the appropriate provider for the stored `providerUrl`.
 * `undefined` / `null` / any URL containing `github.com` → GitHub.
 * Everything else → Gitea-compatible.
 */
export function createGitRemoteProvider(
  providerUrl: string | undefined | null,
): GitRemoteProvider {
  if (!providerUrl || providerUrl.includes('github.com')) {
    return new GitHubProvider();
  }
  return new GiteaProvider(providerUrl);
}
