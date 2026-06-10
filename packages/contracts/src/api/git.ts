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
