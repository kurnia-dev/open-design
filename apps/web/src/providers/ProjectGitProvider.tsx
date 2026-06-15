import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { fetchProjectGitRemote, fetchProjectGitSyncStatus, fetchGitHubAuthStatus } from './registry';
import type { GitHubAuthStatusResponse } from '@open-design/contracts';

export interface SyncStatus {
  ahead: number;
  behind: number;
  status: 'synced' | 'ahead' | 'behind' | 'diverged' | 'no-remote' | 'error';
  error?: string;
  mergeInProgress?: boolean;
}

interface ProjectGitContextValue {
  remoteUrl: string | null;
  syncStatus: SyncStatus | null;
  isLoading: boolean;
  githubAuth: GitHubAuthStatusResponse | null;
  refreshGitState: () => Promise<void>;
  setRemoteUrlState: (url: string | null) => void;
}

const ProjectGitContext = createContext<ProjectGitContextValue | null>(null);

export function ProjectGitProvider({
  projectId,
  children,
  filesRefreshKey = 0,
}: {
  projectId?: string;
  children: ReactNode;
  filesRefreshKey?: number;
}) {
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [githubAuth, setGitHubAuth] = useState<GitHubAuthStatusResponse | null>(null);

  const refreshGitState = useCallback(async () => {
    setIsLoading(true);
    try {
      const auth = await fetchGitHubAuthStatus().catch(() => ({ connected: false }));
      setGitHubAuth(auth);

      if (projectId) {
        const remote = await fetchProjectGitRemote(projectId);
        setRemoteUrl(remote.remoteUrl);
        if (remote.remoteUrl) {
          const sync = await fetchProjectGitSyncStatus(projectId);
          setSyncStatus(sync);
        } else {
          setSyncStatus({ ahead: 0, behind: 0, status: 'no-remote' });
        }
      } else {
        setRemoteUrl(null);
        setSyncStatus(null);
      }
    } catch (err) {
      console.error('Failed to load GitHub / Sync state', err);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refreshGitState();
  }, [refreshGitState, filesRefreshKey]);

  return (
    <ProjectGitContext.Provider
      value={{
        remoteUrl,
        syncStatus,
        isLoading,
        githubAuth,
        refreshGitState,
        setRemoteUrlState: setRemoteUrl,
      }}
    >
      {children}
    </ProjectGitContext.Provider>
  );
}

export function useProjectGit() {
  const ctx = useContext(ProjectGitContext);
  if (!ctx) throw new Error('useProjectGit must be used within ProjectGitProvider');
  return ctx;
}
