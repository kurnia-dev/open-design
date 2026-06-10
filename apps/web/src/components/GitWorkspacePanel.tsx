import { useEffect, useState, useRef } from 'react';
import { Icon } from './Icon';
import { Spinner } from './Loading';
import {
  fetchProjectGitStatus,
  fetchProjectGitDiff,
  stageProjectGitFiles,
  unstageProjectGitFiles,
  restoreProjectGitFiles,
  commitProjectGit,
} from '../providers/registry';
import type { GitStatusFile } from '@open-design/contracts';
import styles from './GitWorkspacePanel.module.css';

interface Props {
  projectId: string;
  filesRefreshKey?: number;
  onRefreshFiles?: () => void;
}

export function GitWorkspacePanel({ projectId, filesRefreshKey = 0, onRefreshFiles }: Props) {
  const [loading, setLoading] = useState(true);
  const [branch, setBranch] = useState('main');
  const [files, setFiles] = useState<GitStatusFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<GitStatusFile | null>(null);
  const [diffText, setDiffText] = useState<string>('');
  const [cachedDiffText, setCachedDiffText] = useState<string>('');
  const [commitMsg, setCommitMsg] = useState('');
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = async (autoSelect = false) => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchProjectGitStatus(projectId);
      setBranch(res.branch);
      setFiles(res.files);

      // Keep selected file if it still exists in the changes, or clear it
      if (selectedFile) {
        const stillExists = res.files.find((f) => f.path === selectedFile.path);
        if (stillExists) {
          setSelectedFile(stillExists);
          await loadDiff(stillExists.path);
        } else {
          setSelectedFile(null);
          setDiffText('');
          setCachedDiffText('');
        }
      } else if (autoSelect && res.files.length > 0) {
        const first = res.files[0]!;
        setSelectedFile(first);
        await loadDiff(first.path);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load git status');
    } finally {
      setLoading(false);
    }
  };

  const loadDiff = async (filePath: string) => {
    try {
      const res = await fetchProjectGitDiff(projectId, filePath);
      setDiffText(res.diff);
      setCachedDiffText(res.cachedDiff);
    } catch (err: any) {
      console.error('Failed to load diff', err);
    }
  };

  useEffect(() => {
    void loadStatus(true);
  }, [projectId, filesRefreshKey]);

  const handleSelectFile = async (file: GitStatusFile) => {
    setSelectedFile(file);
    await loadDiff(file.path);
  };

  const handleStage = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    try {
      await stageProjectGitFiles(projectId, [path]);
      await loadStatus();
      onRefreshFiles?.();
    } catch (err: any) {
      setError(err?.message || 'Failed to stage file');
    }
  };

  const handleUnstage = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    try {
      await unstageProjectGitFiles(projectId, [path]);
      await loadStatus();
      onRefreshFiles?.();
    } catch (err: any) {
      setError(err?.message || 'Failed to unstage file');
    }
  };

  const handleRestore = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    if (!window.confirm(`Are you sure you want to discard all changes in ${path}? This cannot be undone.`)) {
      return;
    }
    try {
      await restoreProjectGitFiles(projectId, [path]);
      await loadStatus();
      onRefreshFiles?.();
    } catch (err: any) {
      setError(err?.message || 'Failed to discard changes');
    }
  };

  const handleStageMultiple = async (paths: string[]) => {
    try {
      if (paths.length === 0) return;
      await stageProjectGitFiles(projectId, paths);
      await loadStatus();
      onRefreshFiles?.();
    } catch (err: any) {
      setError(err?.message || 'Failed to stage files');
    }
  };

  const handleUnstageMultiple = async (paths: string[]) => {
    try {
      if (paths.length === 0) return;
      await unstageProjectGitFiles(projectId, paths);
      await loadStatus();
      onRefreshFiles?.();
    } catch (err: any) {
      setError(err?.message || 'Failed to unstage files');
    }
  };

  const handleCommit = async () => {
    if (!commitMsg.trim()) return;
    try {
      setCommitting(true);
      setError(null);

      // Check if there are staged changes; if none, ask to stage all first
      const staged = files.filter((f) => f.indexStatus !== ' ' && f.indexStatus !== '?');
      if (staged.length === 0) {
        if (window.confirm('There are no staged changes. Stage all changes and commit?')) {
          const allPaths = files.map((f) => f.path);
          await stageProjectGitFiles(projectId, allPaths);
        } else {
          setCommitting(false);
          return;
        }
      }

      await commitProjectGit(projectId, commitMsg.trim());
      setCommitMsg('');
      await loadStatus();
      onRefreshFiles?.();
    } catch (err: any) {
      setError(err?.message || 'Failed to commit changes');
    } finally {
      setCommitting(false);
    }
  };

  // Group files
  const stagedFiles = files.filter((f) => f.indexStatus !== ' ' && f.indexStatus !== '?');
  const unstagedFiles = files.filter((f) => f.workingDirStatus !== ' ' && f.workingDirStatus !== '?');
  const untrackedFiles = files.filter((f) => f.indexStatus === '?' && f.workingDirStatus === '?');

  const renderDiffLines = (diffStr: string) => {
    if (!diffStr) return null;
    const lines = diffStr.split('\n');
    const filteredLines = lines.filter((line) => {
      return !(
        line.startsWith('diff') ||
        line.startsWith('index') ||
        line.startsWith('---') ||
        line.startsWith('+++') ||
        line.startsWith('@@')
      );
    });

    // Digits needed to represent the highest line number — drives the
    // --line-num-digits CSS custom property so the gutter width is dynamic.
    const digits = String(filteredLines.length).length;

    const lineEls = filteredLines.map((line, idx) => {
      let className = styles.diffLine;
      let sign = ' ';

      if (line.startsWith('+')) {
        className = `${styles.diffLine} ${styles.diffAddition}`;
        sign = '+';
      } else if (line.startsWith('-')) {
        className = `${styles.diffLine} ${styles.diffDeletion}`;
        sign = '-';
      }

      return (
        <div key={idx} className={className}>
          <span className={styles.diffLineNum}>{idx + 1}</span>
          <span className={styles.diffGutterSign}>{sign}</span>
          <span className={styles.diffContent}>{line}</span>
        </div>
      );
    });

    return { digits, lineEls };
  };

  return (
    <div className={styles.panel}>
      <div className={styles.sidebar}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.branchInfo}>
            <Icon name="fork" size={14} className={styles.branchIcon} />
            <span className={styles.branchName}>{branch}</span>
          </div>
          <button
            type="button"
            className={`${styles.refreshBtn} od-tooltip`}
            onClick={() => loadStatus()}
            disabled={loading}
            data-tooltip="Refresh Git Status"
            data-tooltip-placement="bottom"
          >
            {loading ? <Spinner size={12} /> : <Icon name="refresh" size={13} />}
          </button>
        </div>

        {/* Commit message area */}
        <div className={styles.commitBox}>
          <textarea
            className={styles.commitInput}
            placeholder="Commit message (Cmd+Enter to commit)..."
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            disabled={committing || files.length === 0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void handleCommit();
              }
            }}
          />
          <button
            type="button"
            className={styles.commitBtn}
            onClick={handleCommit}
            disabled={committing || !commitMsg.trim() || files.length === 0}
          >
            {committing ? <Spinner size={13} /> : 'Commit'}
          </button>
        </div>

        {error ? <div className={styles.errorBox}>{error}</div> : null}

        {/* File lists */}
        <div className={styles.listScroll}>
          {files.length === 0 && !loading ? (
            <div className={styles.emptyStatus}>
              <Icon name="check" size={24} className={styles.emptyIcon} />
              <p>No changes detected</p>
            </div>
          ) : null}

          {/* Staged Changes */}
          {stagedFiles.length > 0 ? (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div className={styles.sectionTitle}>Staged Changes ({stagedFiles.length})</div>
                <button
                  type="button"
                  className={`${styles.stageAllBtn} od-tooltip`}
                  onClick={() => handleUnstageMultiple(stagedFiles.map((f) => f.path))}
                  data-tooltip="Unstage all changes"
                  data-tooltip-placement="bottom"
                >
                  <Icon name="minus" size={12} />
                </button>
              </div>
              <ul className={styles.fileList}>
                {stagedFiles.map((file) => (
                  <li
                    key={file.path}
                    className={`${styles.fileRow} ${selectedFile?.path === file.path ? styles.activeRow : ''}`}
                    onClick={() => handleSelectFile(file)}
                  >
                    <Icon name="file-code" size={14} className={styles.fileIcon} />
                    <span className={styles.fileName} title={file.path}>
                      {file.path.split('/').pop() || file.path}
                      <span className={styles.filePath}>{file.path.includes('/') ? ` in ${file.path.substring(0, file.path.lastIndexOf('/'))}` : ''}</span>
                    </span>
                    <div className={styles.fileStatusGroup}>
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={`${styles.actionBtn} od-tooltip`}
                          onClick={(e) => handleUnstage(e, file.path)}
                          data-tooltip="Unstage changes"
                          data-tooltip-placement="top"
                        >
                          <Icon name="minus" size={12} />
                        </button>
                      </div>
                      <span className={`${styles.badge} ${styles.badgeStaged}`}>M</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Unstaged Changes */}
          {unstagedFiles.length > 0 ? (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div className={styles.sectionTitle}>Changes ({unstagedFiles.length})</div>
                <button
                  type="button"
                  className={`${styles.stageAllBtn} od-tooltip`}
                  onClick={() => handleStageMultiple(unstagedFiles.map((f) => f.path))}
                  data-tooltip="Stage all changes"
                  data-tooltip-placement="bottom"
                >
                  <Icon name="plus" size={12} />
                </button>
              </div>
              <ul className={styles.fileList}>
                {unstagedFiles.map((file) => (
                  <li
                    key={file.path}
                    className={`${styles.fileRow} ${selectedFile?.path === file.path ? styles.activeRow : ''}`}
                    onClick={() => handleSelectFile(file)}
                  >
                    <Icon name="file-code" size={14} className={styles.fileIcon} />
                    <span className={styles.fileName} title={file.path}>
                      {file.path.split('/').pop() || file.path}
                      <span className={styles.filePath}>{file.path.includes('/') ? ` in ${file.path.substring(0, file.path.lastIndexOf('/'))}` : ''}</span>
                    </span>
                    <div className={styles.fileStatusGroup}>
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={`${styles.actionBtn} od-tooltip`}
                          onClick={(e) => handleStage(e, file.path)}
                          data-tooltip="Stage changes"
                          data-tooltip-placement="top"
                        >
                          <Icon name="plus" size={12} />
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionBtn} od-tooltip`}
                          onClick={(e) => handleRestore(e, file.path)}
                          data-tooltip="Discard changes"
                          data-tooltip-placement="top"
                        >
                          <Icon name="close" size={12} />
                        </button>
                      </div>
                      <span className={`${styles.badge} ${styles.badgeUnstaged}`}>M</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Untracked Files */}
          {untrackedFiles.length > 0 ? (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div className={styles.sectionTitle}>Untracked Files ({untrackedFiles.length})</div>
                <button
                  type="button"
                  className={`${styles.stageAllBtn} od-tooltip`}
                  onClick={() => handleStageMultiple(untrackedFiles.map((f) => f.path))}
                  data-tooltip="Stage all untracked files"
                  data-tooltip-placement="bottom"
                >
                  <Icon name="plus" size={12} />
                </button>
              </div>
              <ul className={styles.fileList}>
                {untrackedFiles.map((file) => (
                  <li
                    key={file.path}
                    className={`${styles.fileRow} ${selectedFile?.path === file.path ? styles.activeRow : ''}`}
                    onClick={() => handleSelectFile(file)}
                  >
                    <Icon name="file" size={14} className={styles.fileIcon} />
                    <span className={styles.fileName} title={file.path}>
                      {file.path.split('/').pop() || file.path}
                      <span className={styles.filePath}>{file.path.includes('/') ? ` in ${file.path.substring(0, file.path.lastIndexOf('/'))}` : ''}</span>
                    </span>
                    <div className={styles.fileStatusGroup}>
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={`${styles.actionBtn} od-tooltip`}
                          onClick={(e) => handleStage(e, file.path)}
                          data-tooltip="Add file (stage)"
                          data-tooltip-placement="top"
                        >
                          <Icon name="plus" size={12} />
                        </button>
                      </div>
                      <span className={`${styles.badge} ${styles.badgeUntracked}`}>U</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      {/* Diff View */}
      <div className={styles.diffView}>
        {selectedFile ? (
          <div className={styles.diffContainer}>
            <div className={styles.diffHeaderBar}>
              <span className={styles.diffHeaderTitle}>
                <Icon name="file-code" size={14} className={styles.diffHeaderIcon} />
                {selectedFile.path}
              </span>
              <span className={styles.diffHeaderBranch}>{branch}</span>
            </div>
            <div className={styles.diffBody}>
              {cachedDiffText ? (() => {
                const result = renderDiffLines(cachedDiffText);
                if (!result) return null;
                return (
                  <div className={styles.diffBlock}>
                    <div className={styles.diffBlockTitle}>Staged Diff</div>
                    <pre
                      className={styles.diffPre}
                      style={{ '--line-num-digits': result.digits } as React.CSSProperties}
                    >
                      {result.lineEls}
                    </pre>
                  </div>
                );
              })() : null}
              {diffText ? (() => {
                const result = renderDiffLines(diffText);
                if (!result) return null;
                return (
                  <div className={styles.diffBlock}>
                    <div className={styles.diffBlockTitle}>Unstaged Diff</div>
                    <pre
                      className={styles.diffPre}
                      style={{ '--line-num-digits': result.digits } as React.CSSProperties}
                    >
                      {result.lineEls}
                    </pre>
                  </div>
                );
              })() : null}
              {!diffText && !cachedDiffText ? (
                <div className={styles.noDiffContent}>
                  <p>Staged changes or Untracked file (no unstaged diff available)</p>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className={styles.emptyDiff}>
            <Icon name="history" size={48} className={styles.emptyDiffIcon} />
            <h3>Git Version Control</h3>
            <p>Select a file from the sidebar to inspect modifications.</p>
          </div>
        )}
      </div>
    </div>
  );
}
