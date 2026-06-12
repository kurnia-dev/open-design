import type { GitHubRepoItem } from '@open-design/contracts';
import { useEffect, useState, useRef, useMemo } from 'react';
import { fetchGitHubAuthStatus, fetchGitHubRepos } from '../providers/registry';
import { Spinner } from './Loading';
import { Lock, GitFork, BookMarked, ChevronDown } from 'lucide-react';
import { useI18n } from '../i18n';
import styles from './GitHubRepoSelect.module.css';

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
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  const finalPlaceholder = placeholder || t('github.repoSelect.placeholder');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchGitHubAuthStatus().then(auth => {
      if (cancelled) return;
      if (auth.connected) {
        return fetchGitHubRepos().then(r => {
          if (!cancelled) setRepos(r);
        });
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

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

  const filteredRepos = useMemo(() => {
    if (!searchQuery) return repos;
    const q = searchQuery.toLowerCase();
    return repos.filter(r =>
      r.fullName.toLowerCase().includes(q) ||
      (r.description && r.description.toLowerCase().includes(q))
    );
  }, [repos, searchQuery]);

  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <Spinner size={14} /> {t('github.repoSelect.loading')}
      </div>
    );
  }

  const selectedRepo = repos.find(r => r.cloneUrl === value);
  const displayValue = selectedRepo ? selectedRepo.fullName : (value === 'manual' ? t('github.repoSelect.otherManual') : (value || finalPlaceholder));

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
          {selectedRepo && (
            <span style={{ color: 'var(--text-muted)' }}>
              {selectedRepo.private ? <Lock size={15} /> : selectedRepo.fork ? <GitFork size={15} /> : <BookMarked size={15} />}
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
          <div className={styles.optionsList}>
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
