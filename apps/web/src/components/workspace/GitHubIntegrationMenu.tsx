import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../Icon';
import { Spinner } from '../Loading';
import { fetchProjectGitRemote, setProjectGitRemote } from '../../providers/registry';
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
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const [loading, setLoading] = useState(true);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [newRemoteUrl, setNewRemoteUrl] = useState('');
  const [showRemoteForm, setShowRemoteForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function loadRemote() {
      try {
        setLoading(true);
        const remote = await fetchProjectGitRemote(projectId);
        if (!mounted) return;
        setRemoteUrl(remote.remoteUrl);
        if (remote.remoteUrl) {
          setNewRemoteUrl(remote.remoteUrl);
        }
      } catch (err) {
        console.error('Failed to load remote', err);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void loadRemote();
    return () => { mounted = false; };
  }, [projectId]);

  const handleSetRemote = async () => {
    if (!newRemoteUrl.trim()) return;
    try {
      setLoading(true);
      await setProjectGitRemote(projectId, newRemoteUrl.trim());
      setRemoteUrl(newRemoteUrl.trim());
      setShowRemoteForm(false);
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
      const width = 320;
      // Position bottom-right aligned with the avatar
      const left = Math.max(12, Math.min(r.right - width, window.innerWidth - width - 12));
      setPos({ top: r.bottom + 6, left });
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
      const target = e.target as Node;
      if (anchor?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
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
      style={{ top: pos.top, left: pos.left }}
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
          <div className={styles.connectForm}>
            <input
              type="text"
              placeholder="https://github.com/owner/repo.git"
              value={newRemoteUrl}
              onChange={(e) => setNewRemoteUrl(e.target.value)}
              className={styles.connectInput}
            />
            {error && <div style={{ color: 'var(--red)', fontSize: '11px' }}>{error}</div>}
            <div className={styles.connectActionGroup}>
              <button type="button" onClick={() => setShowRemoteForm(false)} className={styles.cancelBtn}>
                Cancel
              </button>
              <button type="button" onClick={handleSetRemote} className={styles.connectBtn} disabled={!newRemoteUrl.trim() || loading}>
                {loading ? <Spinner size={10} /> : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <span className={styles.remoteUrl}>
            {loading ? <Spinner size={12} /> : remoteUrl || 'No remote configured'}
          </span>
        )}
      </div>
    </div>,
    document.body
  );
}
