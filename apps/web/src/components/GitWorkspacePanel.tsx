import type { GitHubAuthStatusResponse, GitStatusFile, GitStatusResponse } from '@open-design/contracts';
import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { useProjectGit } from '../providers/ProjectGitProvider';
import { streamMessage } from '../providers/anthropic';
import {
  commitProjectGit,
  fetchProjectGitDiff,
  fetchProjectGitRemote,
  fetchProjectGitStatus,
  fetchProjectGitSyncStatus,
  pullProjectGit,
  pushProjectGit,
  restoreProjectGitFiles,
  stageProjectGitFiles,
  unstageProjectGitFiles
} from '../providers/registry';
import type { AppConfig, ChatMessage } from '../types';
import styles from './GitWorkspacePanel.module.css';
import { Icon } from './Icon';
import { Spinner } from './Loading';

interface Props {
  projectId: string;
  filesRefreshKey?: number;
  onRefreshFiles?: () => void;
  /** AppConfig for simple AI text completions (commit message generation).
   *  streamMessage is called directly — no agent session, no file edits. */
  chatConfig?: AppConfig;
  githubAuth?: GitHubAuthStatusResponse;
  onOpenGitHubSettings?: () => void;
}

export function GitWorkspacePanel({
  projectId,
  filesRefreshKey = 0,
  onRefreshFiles,
  chatConfig,
  githubAuth,
  onOpenGitHubSettings,
}: Props) {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [branch, setBranch] = useState('main');
  const [files, setFiles] = useState<GitStatusFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<GitStatusFile | null>(null);
  const [diffText, setDiffText] = useState<string>('');
  const [cachedDiffText, setCachedDiffText] = useState<string>('');
  const [commitMsg, setCommitMsg] = useState('');
  const [committing, setCommitting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { remoteUrl, syncStatus, refreshGitState, isLoading } = useProjectGit();
  const [syncing, setSyncing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [mergeInProgress, setMergeInProgress] = useState(false);


  const handleFullSync = async () => {
    try {
      setSyncing(true);
      setError(null);
      await pullProjectGit(projectId);
      await pushProjectGit(projectId);
      onRefreshFiles?.();
    } catch (err: any) {
      console.log("error", err.message);
      setError(err?.message || 'Sync failed');
    } finally {
      const [statusRes] = await Promise.all([
        loadStatus().catch(() => null),
        refreshGitState().catch(() => { })
      ]);
      const hasConflictNow =
        (statusRes && (statusRes.mergeInProgress || statusRes.files.some(f => f.indexStatus === 'U' || f.workingDirStatus === 'U'))) ||
        !!syncStatus?.mergeInProgress;
      if (hasConflictNow) {
        setError(null);
      }
      setSyncing(false);
    }
  };

  const isConflicted = (f: GitStatusFile) =>
    f.indexStatus === 'U' ||
    f.workingDirStatus === 'U' ||
    (f.indexStatus === 'D' && f.workingDirStatus === 'D') ||
    (f.indexStatus === 'A' && f.workingDirStatus === 'A');

  // Group files
  const conflictedFiles = files.filter(isConflicted);
  const stagedFiles = files.filter((f) => f.indexStatus !== ' ' && f.indexStatus !== '?' && !isConflicted(f));
  const unstagedFiles = files.filter((f) => f.workingDirStatus !== ' ' && f.workingDirStatus !== '?' && !isConflicted(f));
  const untrackedFiles = files.filter((f) => f.indexStatus === '?' && f.workingDirStatus === '?' && !isConflicted(f));
  const hasConflict =
    mergeInProgress ||
    !!syncStatus?.mergeInProgress ||
    conflictedFiles.length > 0;

  const handleGenerateCommitMsg = async () => {
    if (stagedFiles.length === 0 || !chatConfig) return;

    try {
      setGenerating(true);
      setError(null);
      setCommitMsg('');

      const { cachedDiff } = await fetchProjectGitDiff(projectId);
      if (!cachedDiff) {
        setError('No staged changes found to generate a commit message.');
        setGenerating(false);
        return;
      }

      const systemPrompt = `\
You are a senior engineer who writes perfect git commit messages for the Open Design project.

## CRITICAL OUTPUT RULE
Output ONLY the raw commit message text. No markdown fences, no "here is the commit message", no explanation, no notes, no suggestions. The entire response is pasted verbatim into a git commit — anything other than the commit message will corrupt it.

## Format

<type>(<scope>): <subject>

<body>

<footer>

- The HEADER (type + subject) is required.
- Scope is optional but preferred when the change is clearly scoped to one area (e.g., git, chat, daemon, web, contracts, editor, diff-view).
- BODY is required unless the change is a single-line trivial chore or style fix.
- FOOTER must always include a Co-Authored-By line identifying the AI model that generated this message (see below).
- Use BREAKING CHANGE: in the footer only when the diff introduces one.
- All lines must be 100 characters or fewer.

## Commit Types

| Type    | When to use                                   |
|---------|-----------------------------------------------|
| feat    | New user-visible feature                      |
| fix     | Bug fix                                       |
| ref     | Refactor with no behavior change              |
| perf    | Performance improvement                       |
| docs    | Documentation only                            |
| test    | Test additions or corrections                 |
| build   | Build system or dependency changes            |
| ci      | CI configuration                              |
| chore   | Maintenance, cleanup, config tweaks           |
| style   | Code formatting, no logic change              |

## Subject Line Rules

- Imperative present tense: "Add feature" not "Added feature" or "Adds feature"
- Capitalize the first letter of the subject
- No period at the end
- Maximum 70 characters
- Describe WHAT changes, not HOW

## Body Rules

- Blank line between header and body
- Explain WHAT changed and WHY, not how the code works
- Imperative mood, present tense
- Wrap at 100 characters per line
- Multiple bullet points with "-" are fine for multi-change commits

## Co-Authored-By (required)

Always include a footer identifying yourself. Use your own model name and canonical email:

  Co-Authored-By: <Your Model Name> <your-email>

Examples:
  Co-Authored-By: Claude <noreply@anthropic.com>
  Co-Authored-By: Gemini <noreply@google.com>
  Co-Authored-By: GPT-4o <noreply@openai.com>

This is the ONLY AI-related text permitted in the commit. Never write "Generated by AI",
"Written with Claude", or similar phrases anywhere else.

## Examples of GOOD output

feat(git): Add AI-powered commit message generation

Add a sparkles button inside the commit message textarea that calls the
project's AI completion endpoint with the staged diff as context. The
generated message streams in token by token using the onDelta callback,
giving immediate visual feedback.

Co-Authored-By: Claude <noreply@anthropic.com>

---

fix(diff-view): Remove duplicate git headers from diff output

The raw diff contained "diff --git", "index", "---", "+++" and "@@"
meta-lines that cluttered the viewer. Filter them before rendering so
only actual changed lines appear.

Co-Authored-By: Gemini <noreply@google.com>

---

ref(git-panel): Move Git Changes from tab strip to action bar

Replace the in-strip git-tab with a fork icon button in the right-side
ws-tabs-actions cluster. This keeps the tab strip reserved for file tabs
while Git access remains persistent and always visible.

Co-Authored-By: Claude <noreply@anthropic.com>

## What you must NOT do

- Do not write "Here is the commit message:" or any preamble
- Do not wrap the output in \`\`\` code fences
- Do not add notes, warnings, suggestions, or unstaged-file advice
- Do not add issue references unless the diff contains an explicit issue number
- Do not omit the Co-Authored-By footer
`;

      const stagedPaths = stagedFiles.map((f) => f.path).join('\n');
      const userPrompt = `Staged files:\n${stagedPaths}\n\nStaged diff:\n\`\`\`diff\n${cachedDiff}\n\`\`\``;

      if (chatConfig.mode === 'daemon') {
        // In daemon mode there is no BYOK api key in the browser.
        // The daemon resolves the provider from its own env vars (or the
        // forwarded chatProvider credentials for BYOK-style daemon configs).
        const chatProvider = chatConfig.apiKey
          ? {
            provider: chatConfig.apiProtocol || 'anthropic',
            apiKey: chatConfig.apiKey,
            model: chatConfig.model,
            baseUrl: chatConfig.baseUrl,
          }
          : undefined;

        const resp = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/git/suggest-commit`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemPrompt,
              userPrompt,
              chatProvider,
              chatAgentId: chatConfig.agentId,
            }),
          },
        );
        if (!resp.ok) {
          const json = await resp.json().catch(() => ({})) as any;
          const errorMessage = typeof json.error === 'object' ? json.error?.message : json.error;
          setError(errorMessage || `AI generation failed (${resp.status})`);
          setGenerating(false);
          return;
        }
        const json = await resp.json() as { text?: string };
        setCommitMsg(json.text ?? '');
        setGenerating(false);
      } else {
        // API-key mode — call the provider directly from the browser.
        const controller = new AbortController();
        const history: ChatMessage[] = [
          { id: crypto.randomUUID(), role: 'user', content: userPrompt, createdAt: Date.now() },
        ];
        void streamMessage(chatConfig, systemPrompt, history, controller.signal, {
          onDelta: (delta) => {
            setCommitMsg((prev) => prev + delta);
          },
          onDone: () => {
            setGenerating(false);
          },
          onError: (err) => {
            setError(err.message);
            setGenerating(false);
          },
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setGenerating(false);
    }
  };

  const loadStatus = async (autoSelect = false): Promise<GitStatusResponse | null> => {
    try {
      setLoading(true);
      const res = await fetchProjectGitStatus(projectId);
      setBranch(res.branch);
      setFiles(res.files);
      setMergeInProgress(!!res.mergeInProgress);
      if (error === 'Failed to load git status') {
        setError(null);
      }

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
      return res;
    } catch (err: any) {
      setError(err?.message || 'Failed to load git status');
      return null;
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
    // Load happens in ProjectGitProvider
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
      await refreshGitState();
      onRefreshFiles?.();
    } catch (err: any) {
      setError(err?.message || 'Failed to commit changes');
    } finally {
      setCommitting(false);
    }
  };

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
            {remoteUrl && syncStatus && syncStatus.status !== 'no-remote' && (!remoteUrl.includes('github.com') || githubAuth?.connected) && (
              <button
                type="button"
                className={`${styles.compactSyncBtn} od-tooltip`}
                onClick={handleFullSync}
                disabled={syncing || pulling || pushing || isLoading}
                data-tooltip={t('workspace.gitSync')}
                data-tooltip-placement="bottom"
              >
                <Icon
                  name="refresh"
                  size={12}
                  className={syncing || pulling || pushing || isLoading ? styles.spinIcon : undefined}
                />
                <span className={styles.compactSyncNumbers}>
                  {isLoading ? 0 : syncStatus.behind}↓ {isLoading ? 0 : syncStatus.ahead}↑
                </span>
              </button>
            )}
          </div>
          <button
            type="button"
            className={`${styles.refreshBtn} od-tooltip`}
            onClick={async () => {
              await Promise.all([
                loadStatus().catch(() => {}),
                refreshGitState().catch(() => {})
              ]);
            }}
            disabled={loading || isLoading}
            data-tooltip={t('workspace.gitRefresh')}
            data-tooltip-placement="bottom"
          >
            <Icon name="refresh" size={13} className={loading || isLoading ? styles.spinIcon : undefined} />
          </button>
        </div>

        {!githubAuth?.connected && (
          <div className={styles.githubNotice}>
            <Icon name="info" size={14} />
            <span>
              {t('workspace.gitGithubNotice')}
            </span>
          </div>
        )}

        {/* Commit message area */}
        <div className={styles.commitBox}>
          <div className={styles.commitInputWrapper}>
            <textarea
              className={styles.commitInput}
              placeholder={t('workspace.gitCommitPlaceholder')}
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              disabled={committing || files.length === 0 || !githubAuth?.connected}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  if (!githubAuth?.connected) return;
                  void handleCommit();
                }
              }}
            />
            {chatConfig && (
              <button
                type="button"
                className={`${styles.generateBtn} od-tooltip`}
                onClick={handleGenerateCommitMsg}
                disabled={committing || generating || stagedFiles.length === 0 || !githubAuth?.connected}
                data-tooltip={t('workspace.gitCommitGenerate')}
                data-tooltip-placement="bottom"
              >
                {generating ? <Spinner size={14} /> : <Icon name="sparkles" size={14} />}
              </button>
            )}
          </div>
          <button
            type="button"
            className={styles.commitBtn}
            onClick={handleCommit}
            disabled={committing || !commitMsg.trim() || files.length === 0 || !githubAuth?.connected}
          >
            {committing ? <Spinner size={13} /> : t('workspace.gitCommitBtn')}
          </button>
        </div>

        {hasConflict && (
          <div className={styles.conflictNotice}>
            <Icon name="info" size={16} style={{ color: 'var(--warning, #f59e0b)', marginTop: '1px', flexShrink: 0 }} />
            <div className={styles.conflictNoticeText}>
              <div className={styles.conflictTitle}>Merge Conflict Detected</div>
              <div className={styles.conflictDescription}>
                Automatic merge failed. Please open this project in your code editor (like VS Code) to resolve the merge conflicts and commit the changes.
              </div>
            </div>
          </div>
        )}

        {error && !hasConflict ? (
          <div className={styles.errorBox}>
            <div className={styles.errorContent}>{error}</div>
            <button
              type="button"
              className={styles.errorCloseBtn}
              onClick={() => setError(null)}
              aria-label={t('common.close')}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        ) : null}

        {/* File lists */}
        <div className={styles.listScroll}>
          {files.length === 0 && !loading ? (
            <div className={styles.emptyStatus}>
              <Icon name="check" size={24} className={styles.emptyIcon} />
              <p>No changes detected</p>
            </div>
          ) : null}

          {/* Merge Conflicts */}
          {conflictedFiles.length > 0 ? (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div className={styles.sectionTitle} style={{ color: 'var(--red, #ef4444)' }}>Merge Conflicts ({conflictedFiles.length})</div>
              </div>
              <ul className={styles.fileList}>
                {conflictedFiles.map((file) => (
                  <li
                    key={file.path}
                    className={`${styles.fileRow} ${selectedFile?.path === file.path ? styles.activeRow : ''}`}
                    onClick={() => handleSelectFile(file)}
                  >
                    <Icon name="file-code" size={14} className={styles.fileIcon} style={{ color: 'var(--red, #ef4444)' }} />
                    <span className={styles.fileName} title={file.path}>
                      {file.path.split('/').pop() || file.path}
                      <span className={styles.filePath}>{file.path.includes('/') ? ` in ${file.path.substring(0, file.path.lastIndexOf('/'))}` : ''}</span>
                    </span>
                    <div className={styles.fileStatusGroup}>
                      <span className={`${styles.badge} ${styles.badgeConflict}`}>!</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Staged Changes */}
          {stagedFiles.length > 0 ? (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <div className={styles.sectionTitle}>Staged Changes ({stagedFiles.length})</div>
                {!hasConflict && (
                  <button
                    type="button"
                    className={`${styles.stageAllBtn} od-tooltip`}
                    onClick={() => handleUnstageMultiple(stagedFiles.map((f) => f.path))}
                    data-tooltip="Unstage all changes"
                    data-tooltip-placement="bottom"
                  >
                    <Icon name="minus" size={12} />
                  </button>
                )}
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
                      {!hasConflict && (
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
                      )}
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
                {!hasConflict && (
                  <button
                    type="button"
                    className={`${styles.stageAllBtn} od-tooltip`}
                    onClick={() => handleStageMultiple(unstagedFiles.map((f) => f.path))}
                    data-tooltip="Stage all changes"
                    data-tooltip-placement="bottom"
                  >
                    <Icon name="plus" size={12} />
                  </button>
                )}
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
                      {!hasConflict && (
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
                      )}
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
                <div className={styles.sectionTitle}>{t('workspace.gitChangesUntracked')} ({untrackedFiles.length})</div>
                {!hasConflict && (
                  <button
                    type="button"
                    className={`${styles.stageAllBtn} od-tooltip`}
                    onClick={() => handleStageMultiple(untrackedFiles.map((f) => f.path))}
                    data-tooltip={t('workspace.gitStageAll')}
                    data-tooltip-placement="bottom"
                  >
                    <Icon name="plus" size={12} />
                  </button>
                )}
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
                      {!hasConflict && (
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
                      )}
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
