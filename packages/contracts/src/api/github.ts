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


export interface GitHubDeviceFlowStartResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface GitHubDeviceFlowPollRequest {
  deviceCode: string;
}

export type GitHubDeviceFlowPollResponse =
  | { pending: true; error?: string }
  | { connected: true; username: string; avatarUrl: string; scopes: string[]; savedAt: number };

export interface GitHubRepoItem {
  fullName: string;
  cloneUrl: string;
  private: boolean;
  fork?: boolean;
  description?: string | null;
}

export type GitHubReposResponse = GitHubRepoItem[];

export interface GitHubOwnerItem {
  login: string;
  avatarUrl: string;
  type: 'user' | 'organization';
}

export type GitHubOwnersResponse = GitHubOwnerItem[];


export interface GitHubRepoCheckResponse {
  available: boolean;
}
