export interface OpenDesignGithubRepoResponse {
  repo: string;
  stargazers_count: number;
  fetchedAt: number;
  stale: boolean;
}

export interface OpenDesignGithubLatestReleaseResponse {
  repo: string;
  tag_name: string;
  html_url: string;
  fetchedAt: number;
  stale: boolean;
}

export interface GitHubAuthStatusResponse {
  connected: boolean;
  username?: string;
  avatarUrl?: string;
  scopes?: string[];
  savedAt?: number;
}

export interface GitHubConnectRequest {
  token: string;
}

