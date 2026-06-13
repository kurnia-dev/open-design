import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../Icon';
import { Spinner } from '../Loading';
import { createGitHubRepo, fetchGitHubRepoInfo, setProjectGitRemote } from '../../providers/registry';
import { GitHubRepoSelect } from '../GitHubRepoSelect';
import { GitHubRepoCreateForm, type GitHubRepoCreateData } from '../GitHubRepoCreateForm';
import { useProjectGit } from '../../providers/ProjectGitProvider';
import { useI18n } from '../../i18n';
import { Lock, GitFork, BookMarked } from 'lucide-react';
import type { GitHubAuthStatusResponse } from '@open-design/contracts';
import styles from './GitHubIntegrationMenu.module.css';

interface Props {
  anchor: HTMLElement | null;
  projectId: string;
  githubAuth?: GitHubAuthStatusResponse;
  onOpenGitHubSettings?: () => void;
  onClose: () => void;
  onRemoteChanged?: () => void;
}

export function GitHubIntegrationMenu({
  anchor,
  projectId,
  githubAuth,
  onOpenGitHubSettings,
  onClose,
  onRemoteChanged,
}: Props) {
  const { t } = useI18n();
  const { remoteUrl, refreshGitState, setRemoteUrlState } = useProjectGit();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  const [loading, setLoading] = useState(true);
  const [newRemoteUrl, setNewRemoteUrl] = useState('');
  const [showRemoteForm, setShowRemoteForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<'create' | 'existing'>('create');
  const [createData, setCreateData] = useState<GitHubRepoCreateData>({
    owner: githubAuth?.username ?? '',
    ownerType: 'user',
    name: '',
    private: true,
  });
  const [repoInfo, setRepoInfo] = useState<{ fullName: string; private: boolean; fork?: boolean; description?: string | null } | null>(null);
  const [loadingRepoInfo, setLoadingRepoInfo] = useState(false);

  useEffect(() => {
    if (remoteUrl) setNewRemoteUrl(cleanGitUrl(remoteUrl));
    setLoading(false);
  }, [remoteUrl]);

  useEffect(() => {
    if (!remoteUrl) {
      setRepoInfo(null);
      return;
    }
    const parsed = parseGitHubUrl(remoteUrl);
    if (!parsed) {
      setRepoInfo(null);
      return;
    }

    let cancelled = false;
    setLoadingRepoInfo(true);
    fetchGitHubRepoInfo(parsed.owner, parsed.repo)
      .then((info) => {
        if (!cancelled) setRepoInfo(info);
      })
      .catch((err) => {
        console.error('Failed to fetch repository info:', err);
        if (!cancelled) {
          setRepoInfo({
            fullName: `${parsed.owner}/${parsed.repo}`,
            private: true,
            description: null,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingRepoInfo(false);
      });

    return () => {
      cancelled = true;
    };
  }, [remoteUrl, githubAuth]);

  // Reset error on any user interaction/input
  useEffect(() => {
    setError(null);
  }, [createData, newRemoteUrl, formMode, showRemoteForm]);

  const handleSetRemote = async () => {
    if (!newRemoteUrl.trim()) return;
    try {
      setError(null);
      setLoading(true);
      await setProjectGitRemote(projectId, newRemoteUrl.trim());
      setRemoteUrlState(newRemoteUrl.trim());
      setShowRemoteForm(false);
      await refreshGitState();
      onRemoteChanged?.();
    } catch (err: any) {
      setError(err?.message || 'Failed to set remote URL');
    } finally {
      setLoading(false);
    }
  };

  useLayoutEffect(() => {
    if (!anchor) return;
    function update() {
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      // Right-anchor: align menu's right edge with anchor's right edge, clamp to viewport
      const right = Math.max(12, window.innerWidth - r.right);
      setPos({ top: r.bottom + 6, right });
    }
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [anchor]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (anchor?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      if (target.closest?.('.od-select-menu')) return;
      // Allow clicks inside any floating dropdown (repo select, visibility, owner)
      if (target.closest?.('[data-floating-menu]')) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchor, onClose]);

  if (!pos) return null;

  return createPortal(
    <div
      ref={menuRef}
      className={styles.menu}
      style={{ top: pos.top, right: pos.right, width: showRemoteForm ? 480 : 340 }}
      role="dialog"
      aria-label="GitHub Integration"
    >
      <div className={styles.githubCard}>
        {githubAuth?.connected ? (
          <div className={styles.githubHeader}>
            {githubAuth.avatarUrl ? (
              <img src={githubAuth.avatarUrl} alt={githubAuth.username} className={styles.githubAvatar} />
            ) : (
              <Icon name="github" size={20} />
            )}
            <div className={styles.githubDetails}>
              <span className={styles.githubUser}>@{githubAuth.username}</span>
              <span className={styles.githubStatusText}>GitHub Connected</span>
            </div>
            {onOpenGitHubSettings && (
              <button
                type="button"
                onClick={() => {
                  onOpenGitHubSettings();
                  onClose();
                }}
                className={styles.disconnectBtn}
              >
                Manage
              </button>
            )}
          </div>
        ) : (
          <div className={styles.githubHeader}>
            <Icon name="github" size={20} />
            <div className={styles.githubDetails}>
              <span className={styles.githubUser}>GitHub Integration</span>
              <span className={styles.githubStatusText}>Not connected</span>
            </div>
            <button
              type="button"
              onClick={() => {
                onOpenGitHubSettings?.();
                onClose();
              }}
              className={styles.connectBtn}
            >
              Connect
            </button>
          </div>
        )}
      </div>

      <div className={styles.remoteBox}>
        <div className={styles.remoteHeader}>
          <span>Remote (origin)</span>
          {!showRemoteForm && (
            <button type="button" onClick={() => setShowRemoteForm(true)} className={styles.editRemoteBtn}>
              {remoteUrl ? 'Edit' : 'Configure'}
            </button>
          )}
        </div>
        {showRemoteForm ? (
          formMode === 'create' ? (
            <div className={styles.createAltBox}>
              <div className={styles.createAltForm}>
                <GitHubRepoCreateForm
                  value={createData}
                  onChange={setCreateData}
                />
              </div>
              {error && <div style={{ color: 'var(--red)', fontSize: '11px' }}>{error}</div>}
              <div className={styles.connectActionGroup}>
                <button type="button" onClick={() => setShowRemoteForm(false)} className={styles.cancelBtn}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.connectBtn}
                  disabled={!createData.owner || !createData.name || loading}
                  onClick={() => {
                    void (async () => {
                      try {
                        setError(null);
                        setLoading(true);
                        const repo = await createGitHubRepo(
                          createData.name,
                          createData.private,
                          createData.owner,
                          createData.ownerType
                        );
                        const url = repo.cloneUrl;
                        await setProjectGitRemote(projectId, url);
                        setRemoteUrlState(url);
                        setShowRemoteForm(false);
                        await refreshGitState();
                        onRemoteChanged?.();
                      } catch (err: any) {
                        setError(err?.message || 'Failed to create repository on GitHub');
                      } finally {
                        setLoading(false);
                      }
                    })();
                  }}
                >
                  {loading ? <Spinner size={10} /> : 'Connect'}
                </button>
              </div>
              {githubAuth?.connected && (
                <button
                  type="button"
                  className={styles.modeToggleBtn}
                  onClick={() => setFormMode('existing')}
                >
                  Use existing repository
                </button>
              )}
            </div>
          ) : (
            <form
              className={styles.connectForm}
              onSubmit={(e) => {
                e.preventDefault();
                if (newRemoteUrl.trim() && !loading) {
                  void handleSetRemote();
                }
              }}
            >
              {githubAuth?.connected ? (
                <GitHubRepoSelect
                  value={newRemoteUrl}
                  onChange={setNewRemoteUrl}
                  triggerClassName={styles.connectInput}
                  menuClassName={styles.selectMenu}
                  placeholder="Select a repository..."
                />
              ) : null}
              {error && <div style={{ color: 'var(--red)', fontSize: '11px' }}>{error}</div>}
              <div className={styles.connectActionGroup}>
                <button type="button" onClick={() => setShowRemoteForm(false)} className={styles.cancelBtn}>
                  Cancel
                </button>
                <button type="submit" className={styles.connectBtn} aria-disabled={!newRemoteUrl.trim() || loading}>
                  {loading ? <Spinner size={10} /> : 'Save'}
                </button>
              </div>
              <button
                type="button"
                className={styles.modeToggleBtn}
                onClick={() => setFormMode('create')}
              >
                Create a new repository instead
              </button>
            </form>
          )
        ) : (
          <div className={styles.repoDetailsCard}>
            {loading || loadingRepoInfo ? (
              <div className={styles.loadingWrapper}>
                <Spinner size={12} />
              </div>
            ) : remoteUrl ? (
              repoInfo ? (
                <>
                  <div className={styles.repoIcon}>
                    {(() => {
                      const RepoIcon = repoInfo.private ? Lock : repoInfo.fork ? GitFork : BookMarked;
                      return <RepoIcon size={16} strokeWidth={2} />;
                    })()}
                  </div>
                  <div className={styles.textWrapper}>
                    <span className={styles.repoName}>
                      {repoInfo.fullName}
                    </span>
                    <span className={styles.repoDesc}>
                      {repoInfo.description || t('github.repoSelect.noDescription')}
                    </span>
                  </div>
                </>
              ) : (
                <span className={styles.remoteUrl}>{cleanGitUrl(remoteUrl)}</span>
              )
            ) : (
              <span className={styles.remoteUrl}>No remote configured</span>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

function cleanGitUrl(url: string | null): string {
  if (!url) return '';
  return url.replace(/^(https?:\/\/)[^@/]+@/, '$1');
}

function parseGitHubUrl(url: string | null): { owner: string; repo: string } | null {
  if (!url) return null;
  const httpsMatch = /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
  const sshMatch = /git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
  if (httpsMatch) {
    return { owner: httpsMatch[1]!, repo: httpsMatch[2]! };
  } else if (sshMatch) {
    return { owner: sshMatch[1]!, repo: sshMatch[2]! };
  }
  return null;
}
