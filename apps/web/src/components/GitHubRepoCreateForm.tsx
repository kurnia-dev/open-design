import type { GitHubOwnerItem } from '@open-design/contracts';
import { Check, ChevronDown, Globe, Lock, Search } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { fetchGitHubAuthStatus, fetchGitHubOwners, checkGitHubRepoAvailability } from '../providers/registry';
import styles from './GitHubRepoCreateForm.module.css';

export interface GitHubRepoCreateData {
  owner: string;
  ownerType: 'user' | 'organization';
  name: string;
  private: boolean;
}

interface Props {
  value: GitHubRepoCreateData;
  onChange: (value: GitHubRepoCreateData) => void;
  suggestedName?: string;
  disabled?: boolean;
}

export function GitHubRepoCreateForm({
  value,
  onChange,
  suggestedName = '',
  disabled = false,
}: Props) {
  const { t } = useI18n();
  const [connected, setConnected] = useState(false);
  const [owners, setOwners] = useState<GitHubOwnerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [ownersOpen, setOwnersOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const ownersContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Check auth and fetch owners on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchGitHubAuthStatus()
      .then((auth) => {
        if (cancelled) return;
        if (auth.connected) {
          setConnected(true);
          return fetchGitHubOwners().then((fetchedOwners) => {
            if (cancelled) return;
            setOwners(fetchedOwners);
            // Default to user profile owner if available
            const userOwner = fetchedOwners.find((o) => o.type === 'user');
            if (userOwner && !value.owner) {
              onChange({
                ...value,
                owner: userOwner.login,
                ownerType: 'user',
              });
            }
          });
        }
      })
      .catch((err) => {
        console.error('Failed to fetch GitHub status/owners:', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Handle click outside of owner dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        ownersContainerRef.current &&
        !ownersContainerRef.current.contains(event.target as Node)
      ) {
        setOwnersOpen(false);
      }
    }
    if (ownersOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    } else {
      setSearchQuery('');
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [ownersOpen]);

  const filteredOwners = useMemo(() => {
    if (!searchQuery) return owners;
    const q = searchQuery.toLowerCase();
    return owners.filter((o) => o.login.toLowerCase().includes(q));
  }, [owners, searchQuery]);

  const selectedOwner = owners.find((o) => o.login === value.owner);

  const cleanSuggestedSlug = useMemo(() => {
    return suggestedName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-_]+/g, '-');
  }, [suggestedName]);

  useEffect(() => {
    if (!value.name.trim() || !value.owner) {
      setIsAvailable(null);
      setValidationError(null);
      setIsValidating(false);
      return;
    }

    setIsValidating(true);
    setValidationError(null);
    setIsAvailable(null);

    const timer = setTimeout(() => {
      checkGitHubRepoAvailability(value.owner, value.name.trim())
        .then((res) => {
          setIsAvailable(res.available);
          if (!res.available) {
            setValidationError('taken');
          }
        })
        .catch((err) => {
          setValidationError('failed');
        })
        .finally(() => {
          setIsValidating(false);
        });
    }, 500);

    return () => clearTimeout(timer);
  }, [value.name, value.owner]);

  if (!connected || loading) {
    return null;
  }

  return (
    <div className={styles.container}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>GitHub Repository</div>
        <div className={styles.sectionOptional}>(Optional)</div>
      </div>

      <div className={styles.formFields}>
        <div className={styles.repoSelectorRow}>
          {/* Owner dropdown selector */}
          <div className={styles.fieldGroup} ref={ownersContainerRef}>
            <span className={styles.fieldLabel}>{t('github.repoCreate.ownerLabel')}</span>
            <button
              type="button"
              className={styles.ownerTrigger}
              onClick={() => !disabled && setOwnersOpen(!ownersOpen)}
              disabled={disabled}
            >
              {selectedOwner ? (
                <>
                  <img
                    src={selectedOwner.avatarUrl}
                    alt={selectedOwner.login}
                    className={styles.ownerAvatar}
                  />
                  <span className={styles.ownerLogin}>{selectedOwner.login}</span>
                </>
              ) : (
                <span className={styles.placeholder}>{t('github.repoCreate.selectOwner')}</span>
              )}
              <ChevronDown size={14} className={styles.chevron} />
            </button>

            {ownersOpen && (
              <div className={styles.ownersDropdown}>
                <div className={styles.dropdownHeader}>{t('github.repoCreate.chooseOwner')}</div>
                <div className={styles.searchBox}>
                  <Search size={14} className={styles.searchIcon} />
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder={t('github.repoCreate.searchOwners')}
                    className={styles.searchInput}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <div className={styles.ownersList}>
                  {filteredOwners.map((owner) => {
                    const isSelected = owner.login === value.owner;
                    return (
                      <button
                        key={owner.login}
                        type="button"
                        className={`${styles.ownerOption} ${isSelected ? styles.selected : ''
                          }`}
                        onClick={() => {
                          onChange({
                            ...value,
                            owner: owner.login,
                            ownerType: owner.type,
                          });
                          setOwnersOpen(false);
                        }}
                      >
                        {isSelected && <Check size={14} className={styles.checkIcon} />}
                        <img
                          src={owner.avatarUrl}
                          alt={owner.login}
                          className={styles.dropdownAvatar}
                        />
                        <span className={styles.dropdownLogin}>{owner.login}</span>
                      </button>
                    );
                  })}
                  {filteredOwners.length === 0 && (
                    <div className={styles.empty}>{t('github.repoCreate.noOwners')}</div>
                  )}
                </div>
              </div>
            )}
          </div>

          <span className={styles.divider}>/</span>

          {/* Repository Name input */}
          <div className={`${styles.fieldGroup} ${styles.flexGrow}`}>
            <span className={styles.fieldLabel}>{t('github.repoCreate.nameLabel')}</span>
            <input
              type="text"
              className={styles.nameInput}
              placeholder={t('github.repoCreate.namePlaceholder')}
              value={value.name}
              onChange={(e) =>
                onChange({
                  ...value,
                  name: e.target.value.toLowerCase().replace(/[^a-z0-9-_]+/g, '-'),
                })
              }
              disabled={disabled}
            />
            {value.name.trim() ? (
              <div className={styles.validationText}>
                {isValidating ? (
                  <span className={styles.validationLoading}>{t('github.repoCreate.checkingAvailability')}</span>
                ) : isAvailable ? (
                  <span className={styles.validationSuccess}>
                    {t('github.repoCreate.available').replace('{name}', value.name)}
                  </span>
                ) : validationError ? (
                  <span className={styles.validationError}>
                    {validationError === 'taken' ? t('github.repoCreate.taken') : t('github.repoCreate.checkFailed')}
                  </span>
                ) : null}
              </div>
            ) : cleanSuggestedSlug && value.name !== cleanSuggestedSlug ? (
              <div className={styles.suggestionText}>
                {t('github.repoCreate.suggestionPrefix')}{' '}
                <button
                  type="button"
                  className={styles.suggestionBtn}
                  onClick={() => onChange({ ...value, name: cleanSuggestedSlug })}
                >
                  {cleanSuggestedSlug}
                </button>
                ?
              </div>
            ) : null}
          </div>
        </div>

        {/* Visibility selection */}
        <div className={styles.visibilityGroup}>
          <span className={styles.fieldLabel}>{t('github.repoCreate.visibilityLabel')}</span>
          <div className={styles.visibilitySelectors}>
            <button
              type="button"
              className={`${styles.visibilityCard} ${value.private ? styles.active : ''
                }`}
              onClick={() => onChange({ ...value, private: true })}
              disabled={disabled}
            >
              <Lock size={16} />
              <div className={styles.visibilityMeta}>
                <strong>{t('github.repoCreate.privateLabel')}</strong>
                <span>{t('github.repoCreate.privateDesc')}</span>
              </div>
            </button>
            <button
              type="button"
              className={`${styles.visibilityCard} ${!value.private ? styles.active : ''
                }`}
              onClick={() => onChange({ ...value, private: false })}
              disabled={disabled}
            >
              <Globe size={16} />
              <div className={styles.visibilityMeta}>
                <strong>{t('github.repoCreate.publicLabel')}</strong>
                <span>{t('github.repoCreate.publicDesc')}</span>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
