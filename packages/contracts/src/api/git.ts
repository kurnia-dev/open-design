export type GitFileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'untracked'
  | 'staged_modified'
  | 'staged_added'
  | 'staged_deleted'
  | 'renamed'
  | 'unknown';

export interface GitStatusFile {
  path: string;
  workingDirStatus: string;
  indexStatus: string;
  status: GitFileStatus;
}

export interface GitStatusResponse {
  hasChanges: boolean;
  branch: string;
  files: GitStatusFile[];
}

export interface GitDiffResponse {
  diff: string;
  cachedDiff: string;
}

export interface GitStageRequest {
  files: string[];
}

export interface GitUnstageRequest {
  files: string[];
}

export interface GitRestoreRequest {
  files: string[];
}

export interface GitCommitRequest {
  message: string;
}

export interface GitRemoteInfoResponse {
  remoteUrl: string | null;
}

export interface GitSetRemoteRequest {
  remoteUrl: string;
}

export interface GitSyncStatusResponse {
  ahead: number;
  behind: number;
  status: 'synced' | 'ahead' | 'behind' | 'diverged' | 'no-remote' | 'error';
  error?: string;
}

