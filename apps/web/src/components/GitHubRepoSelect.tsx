import type { GitHubRepoItem } from '@open-design/contracts';
import { useEffect, useState, useRef, useMemo } from 'react';
import { fetchGitHubAuthStatus, fetchGitHubRepos } from '../providers/registry';
import { Spinner } from './Loading';
import { Lock, GitFork, BookMarked, ChevronDown } from 'lucide-react';
import { useI18n } from '../i18n';
import styles from './GitHubRepoSelect.module.css';

function getRepoDisplayName(url: string, placeholder: string): string {
  if (!url) return placeholder;
  if (url === 'manual') return 'manual';

  // Clean trailing .git
  const clean = url.endsWith('.git') ? url.slice(0, -4) : url;

  // Split by slashes and colons
  const parts = clean.replace(/[:/]/g, '/').split('/').filter(Boolean);
  if (parts.length >= 2) {
    const repo = parts[parts.length - 1];
    const owner = parts[parts.length - 2];
    return `${owner}/${repo}`;
  }
  return url;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  placeholder?: string;
  ariaLabel?: string;
  onSelectManual?: () => void;
  showManualOption?: boolean;
}

export function GitHubRepoSelect({
  value,
  onChange,
  disabled,
  className,
  triggerClassName,
  menuClassName,
  placeholder,
  ariaLabel,
  onSelectManual,
  showManualOption = false,
}: Props) {
  const [repos, setRepos] = useState<GitHubRepoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [connected, setConnected] = useState(false);
  const [fetchedQuery, setFetchedQuery] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  const finalPlaceholder = placeholder || t('github.repoSelect.placeholder');
  const PAGE_LIMIT = 50;

  useEffect(() => {
    let cancelled = false;
    fetchGitHubAuthStatus().then(auth => {
      if (!cancelled) {
        setConnected(auth.connected);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const loadNextPage = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const nextRepos = await fetchGitHubRepos(nextPage, PAGE_LIMIT, searchQuery);
      if (nextRepos.length < PAGE_LIMIT) {
        setHasMore(false);
      }
      setRepos(prev => [...prev, ...nextRepos]);
      setPage(nextPage);
    } catch (err) {
      console.error('Failed to load next page of repos:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  // Load page 1 on first open or search query change
  useEffect(() => {
    if (!isOpen || !connected) return;

    if (fetchedQuery === searchQuery) return;

    let cancelled = false;

    // Immediate fetch on first open (when fetchedQuery is null), otherwise debounce
    const delay = fetchedQuery === null ? 0 : 300;

    const timer = setTimeout(() => {
      setLoading(true);
      fetchGitHubRepos(1, PAGE_LIMIT, searchQuery)
        .then((r) => {
          if (!cancelled) {
            setRepos(r);
            setPage(1);
            setHasMore(r.length >= PAGE_LIMIT);
            setFetchedQuery(searchQuery);
          }
        })
        .catch((err) => {
          console.error('Failed to load repos:', err);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, delay);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, searchQuery, connected, fetchedQuery]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      // Focus input when opened
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    } else {
      setSearchQuery('');
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const filteredRepos = repos;

  const selectedRepo = repos.find(r => r.cloneUrl === value);
  const displayValue = selectedRepo
    ? selectedRepo.fullName
    : (value === 'manual'
      ? t('github.repoSelect.otherManual')
      : (value ? getRepoDisplayName(value, finalPlaceholder) : finalPlaceholder));

  return (
    <div className={[styles.container, className].filter(Boolean).join(' ')} ref={containerRef}>
      <button
        type="button"
        className={[styles.trigger, triggerClassName].filter(Boolean).join(' ')}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        aria-expanded={isOpen}
        aria-label={ariaLabel}
      >
        <span className={styles.triggerContent}>
          {(selectedRepo || (value && value !== 'manual')) && (
            <span style={{ color: 'var(--text-muted)' }}>
              {selectedRepo?.private ? <Lock size={15} /> : selectedRepo?.fork ? <GitFork size={15} /> : <BookMarked size={15} />}
            </span>
          )}
          {displayValue}
        </span>
        <ChevronDown size={14} style={{ color: 'var(--text-muted)', transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'none' }} />
      </button>

      {isOpen && (
        <div className={[styles.menu, menuClassName].filter(Boolean).join(' ')}>
          <div className={styles.searchContainer}>
            <input
              ref={inputRef}
              type="text"
              className={styles.searchInput}
              placeholder={t('github.repoSelect.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setIsOpen(false);
              }}
            />
          </div>
          <div
            className={styles.optionsList}
            onScroll={(e) => {
              const target = e.currentTarget;
              if (target.scrollHeight - target.scrollTop - target.clientHeight < 30) {
                loadNextPage();
              }
            }}
          >
            {loading && page === 1 ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '24px' }}>
                <Spinner size={16} />
              </div>
            ) : (
              <>
                {filteredRepos.length === 0 && (
                  <div className={styles.emptyState}>{t('github.repoSelect.noReposFound')}</div>
                )}
                {filteredRepos.map(r => {
                  const RepoIcon = r.private ? Lock : r.fork ? GitFork : BookMarked;
                  const isSelected = value === r.cloneUrl;
                  return (
                    <button
                      key={r.cloneUrl}
                      type="button"
                      className={`${styles.optionContainer} ${isSelected ? styles.selected : ''}`}
                      onClick={() => {
                        onChange(r.cloneUrl);
                        setIsOpen(false);
                      }}
                    >
                      <div className={styles.repoIcon}>
                        <RepoIcon size={16} strokeWidth={2} />
                      </div>
                      <div className={styles.textWrapper}>
                        <span className={styles.repoName}>
                          {r.fullName}
                        </span>
                        <span className={styles.repoDesc}>
                          {r.description || t('github.repoSelect.noDescription')}
                        </span>
                      </div>
                    </button>
                  );
                })}

                {loadingMore && (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '12px' }}>
                    <Spinner size={14} />
                  </div>
                )}
              </>
            )}

            {showManualOption && (!searchQuery || 'other'.toLowerCase().includes(searchQuery.toLowerCase()) || 'manual'.toLowerCase().includes(searchQuery.toLowerCase())) && (
              <button
                type="button"
                className={styles.optionContainer}
                onClick={() => {
                  if (onSelectManual) onSelectManual();
                  else onChange('manual');
                  setIsOpen(false);
                }}
              >
                <div className={styles.repoIcon}>
                  <BookMarked size={16} strokeWidth={2} />
                </div>
                <div className={styles.textWrapper}>
                  <span className={styles.repoName}>{t('github.repoSelect.otherManual')}</span>
                  <span className={styles.repoDesc}>{t('github.repoSelect.otherManualDesc')}</span>
                </div>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
