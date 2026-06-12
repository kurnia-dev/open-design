import type { GitHubRepoItem } from '@open-design/contracts';
import { useEffect, useState } from 'react';
import { fetchGitHubAuthStatus, fetchGitHubRepos } from '../providers/registry';
import { CustomSelect } from './CustomSelect';
import { Spinner } from './Loading';

interface Props {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  menuClassName?: string;
  triggerClassName?: string;
  placeholder?: string;
  ariaLabel?: string;
  onSelectManual?: () => void;
  showManualOption?: boolean;
}

export function GitHubRepoSelect({
  value,
  onChange,
  disabled,
  menuClassName,
  triggerClassName,
  placeholder = "Select a repository...",
  ariaLabel = "Select a repository",
  onSelectManual,
  showManualOption = false,
}: Props) {
  const [repos, setRepos] = useState<GitHubRepoItem[]>([]);
  const [loading, setLoading] = useState(false);

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

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 13, background: 'var(--bg-app)' }}>
        <Spinner size={12} /> Loading repositories...
      </div>
    );
  }

  const options = [
    ...repos.map(r => ({
      value: r.cloneUrl,
      label: r.private ? `${r.fullName} (Private)` : r.fullName
    })),
    ...(showManualOption ? [{ value: 'manual', label: 'Other (Enter manually...)' }] : [])
  ];

  return (
    <CustomSelect
      value={value}
      options={options}
      onChange={(val) => {
        if (val === 'manual' && onSelectManual) {
          onSelectManual();
        } else {
          onChange(val);
        }
      }}
      disabled={disabled}
      menuClassName={menuClassName}
      triggerClassName={triggerClassName}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      searchable
    />
  );
}
