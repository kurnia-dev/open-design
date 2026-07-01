import { Button } from '@open-design/components';
import type {
  TrackingDesignSystemStatusAction,
  TrackingDesignSystemStatusValue,
} from '@open-design/contracts/analytics';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  trackDesignSystemStatusResult,
  trackDesignSystemsTemplateCardClick,
  trackDesignSystemsTopClick,
  trackPageView,
} from '../analytics/events';
import { useAnalytics } from '../analytics/provider';
import { useI18n } from '../i18n';
import {
  localizeDesignSystemCategory,
  localizeDesignSystemSummary,
} from '../i18n/content';
import { useProjectGit } from '../providers/ProjectGitProvider';
import {
  deleteDesignSystemDraft,
  fetchDesignSystemShowcase,
  importGitDesignSystemStream,
  updateDesignSystemDraft
} from '../providers/registry';
import { buildSrcdoc } from '../runtime/srcdoc';
import type { DesignSystemSummary, ProjectTemplate, Surface } from '../types';
import styles from './DesignSystemsTab.module.css';
import { GitHubRepoSelect } from './GitHubRepoSelect';
import { Icon } from './Icon';

interface Props {
  systems: DesignSystemSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPreview: (id: string) => void;
  onCreate?: () => void;
  onOpenSystem?: (id: string) => void;
  onSystemsRefresh?: () => Promise<void> | void;
  templates?: ProjectTemplate[];
  onOpenSettings?: (section?: any) => void;
}

const CATEGORY_ORDER = [
  'Starter',
  'AI & LLM',
  'Developer Tools',
  'Productivity & SaaS',
  'Backend & Data',
  'Design & Creative',
  'Fintech & Crypto',
  'E-Commerce & Retail',
  'Media & Consumer',
  'Automotive',
];

type SurfaceFilter = 'all' | Surface;
type UserListFilter = 'all' | 'published' | 'draft';
type PrimaryCollection = 'design-system' | 'template';
type DesignSystemCollection = 'mine' | 'official' | 'enterprise';
type TemplateCollection = 'mine' | 'enterprise';

const SURFACE_PILLS: { value: SurfaceFilter; labelKey: 'examples.modeAll' | 'ds.surfaceWeb' | 'ds.surfaceImage' | 'ds.surfaceVideo' | 'ds.surfaceAudio' }[] = [
  { value: 'all', labelKey: 'examples.modeAll' },
  { value: 'web', labelKey: 'ds.surfaceWeb' },
  { value: 'image', labelKey: 'ds.surfaceImage' },
  { value: 'video', labelKey: 'ds.surfaceVideo' },
  { value: 'audio', labelKey: 'ds.surfaceAudio' },
];

function surfaceOf(system: DesignSystemSummary): Surface {
  return system.surface ?? 'web';
}

function isUserSystem(system: DesignSystemSummary): boolean {
  return system.source === 'user' || system.isEditable === true;
}

// `system.status` is the DesignSystemSummary status string from the
// daemon; map it onto the tracking enum used by
// `design_system_status_result.status_before|status_after`. The
// summary type today only carries `'draft' | 'published'`; the wider
// tracking enum keeps room for `ready`/`failed`/`archived` once those
// land server-side. Unknown values collapse to `'unknown'`.
function mapStatusToTracking(
  status: string | null | undefined,
): TrackingDesignSystemStatusValue {
  switch (status) {
    case 'draft':
    case 'published':
      return status;
    default:
      return 'unknown';
  }
}

function formatShortDate(value: number | string | undefined): string {
  if (!value) return 'just now';
  const time = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(time)) return String(value);
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(time));
}

export function DesignSystemsTab({
  systems,
  selectedId,
  onSelect,
  onPreview,
  onCreate,
  onOpenSystem,
  onSystemsRefresh,
  templates = [],
  onOpenSettings,
}: Props) {
  const { locale, t } = useI18n();
  const analytics = useAnalytics();
  const designSystemsPageViewFiredRef = useRef(false);
  useEffect(() => {
    if (designSystemsPageViewFiredRef.current) return;
    designSystemsPageViewFiredRef.current = true;
    // v2 doc: the DS list page also carries `area` / `view_type` /
    // `entry_from` so it can stitch the cross-surface DS funnel.
    // `entry_from` is `unknown` here because the tab is reached
    // through the home nav rail; a router-aware entry mapper can
    // refine this later.
    trackPageView(analytics.track, {
      page_name: 'design_systems',
      area: 'design_system_list',
      view_type: 'page',
      entry_from: 'unknown',
      available_design_system_count: systems.length,
    });
  }, [analytics.track, systems.length]);
  const searchTrackedRef = useRef(false);
  const categoryTrackedRef = useRef(false);
  const [filter, setFilter] = useState('');
  const [userFilter, setUserFilter] = useState<UserListFilter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [primaryCollection, setPrimaryCollection] = useState<PrimaryCollection>('design-system');
  const [designSystemCollection, setDesignSystemCollection] = useState<DesignSystemCollection>('mine');
  const [templateCollection, setTemplateCollection] = useState<TemplateCollection>('mine');
  const [surfaceFilter, setSurfaceFilter] = useState<SurfaceFilter>('all');

  const [importOpen, setImportOpen] = useState(false);
  const [deleteModalSystem, setDeleteModalSystem] = useState<DesignSystemSummary | null>(null);
  const [category, setCategory] = useState<string>('All');
  // Cache fetched showcase HTML across re-renders so cards never re-flicker
  // when the user filters / scrolls back. null = "in flight"; undefined =
  // "not yet requested". Mirrors the pattern used by ExamplesTab.
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});

  const librarySystems = useMemo(
    () => systems.filter((system) => !isUserSystem(system)),
    [systems],
  );

  const surfaceScoped = useMemo(
    () => surfaceFilter === 'all'
      ? librarySystems
      : librarySystems.filter((s) => surfaceOf(s) === surfaceFilter),
    [librarySystems, surfaceFilter],
  );

  const userSystems = useMemo(() => {
    const editable = systems.filter(isUserSystem);
    if (userFilter === 'all') return editable;
    return editable.filter((system) => (system.status ?? 'draft') === userFilter);
  }, [systems, userFilter]);

  // Total systems per surface, ignoring every active filter. Drives the
  // "this surface is now empty" fallback below — that guard must react to
  // the catalog itself, not to a transient style/search filter.
  const surfaceTotals = useMemo(() => {
    const counts: Record<SurfaceFilter, number> = { all: librarySystems.length, web: 0, image: 0, video: 0, audio: 0 };
    for (const s of librarySystems) counts[surfaceOf(s)]++;
    return counts;
  }, [librarySystems]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const s of surfaceScoped) cats.add(s.category || 'Uncategorized');
    const ordered: string[] = [];
    for (const c of CATEGORY_ORDER) if (cats.has(c)) ordered.push(c);
    for (const c of [...cats].sort()) if (!ordered.includes(c)) ordered.push(c);
    return ['All', ...ordered];
  }, [surfaceScoped]);

  // Keep surfaceFilter and category in sync when systems changes dynamically.
  // If the currently selected surface has zero items, fall back to 'all'.
  // If the current category is no longer present in the filtered list, fall back to 'All'.
  useEffect(() => {
    if (surfaceFilter !== 'all' && surfaceTotals[surfaceFilter] === 0) {
      setSurfaceFilter('all');
      setCategory('All');
    } else if (category !== 'All' && !categories.includes(category)) {
      setCategory('All');
    }
  }, [systems, surfaceFilter, surfaceTotals, category, categories]);

  // Systems matching the active style category and search text, before the
  // surface filter is applied. Both the surface pill counts and the visible
  // grid derive from this so a surface chip always reports its own result
  // set rather than the unfiltered catalog total.
  const queryScoped = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return librarySystems.filter((s) => {
      if (category !== 'All' && (s.category || 'Uncategorized') !== category) return false;
      if (!q) return true;
      const summary = localizeDesignSystemSummary(locale, s).toLowerCase();
      const categoryLabel = localizeDesignSystemCategory(
        locale,
        s.category || 'Uncategorized',
      ).toLowerCase();
      return (
        s.title.toLowerCase().includes(q) ||
        s.summary.toLowerCase().includes(q) ||
        summary.includes(q) ||
        categoryLabel.includes(q)
      );
    });
  }, [librarySystems, filter, category, locale]);

  const surfaceCounts = useMemo(() => {
    const counts: Record<SurfaceFilter, number> = {
      all: queryScoped.length, web: 0, image: 0, video: 0, audio: 0,
    };
    for (const s of queryScoped) counts[surfaceOf(s)]++;
    return counts;
  }, [queryScoped]);

  const filtered = useMemo(
    () => surfaceFilter === 'all'
      ? queryScoped
      : queryScoped.filter((s) => surfaceOf(s) === surfaceFilter),
    [queryScoped, surfaceFilter],
  );

  // Category metadata is authored in English; keep raw values in state for
  // filtering while localizing the visible labels for the current UI locale.
  const renderCategory = (c: string) => {
    if (c === 'All') return t('ds.categoryAll');
    if (c === 'Uncategorized') return t('ds.categoryUncategorized');
    return localizeDesignSystemCategory(locale, c);
  };

  function loadThumb(id: string) {
    setThumbs((prev) => {
      if (prev[id] !== undefined) return prev;
      void fetchDesignSystemShowcase(id).then((html) => {
        setThumbs((p) => ({ ...p, [id]: html }));
      });
      return { ...prev, [id]: null };
    });
  }

  async function refreshSystems() {
    await onSystemsRefresh?.();
  }

  async function togglePublished(system: DesignSystemSummary) {
    setBusyId(system.id);
    const startedAt = performance.now();
    const willPublish = system.status !== 'published';
    const action: TrackingDesignSystemStatusAction = willPublish
      ? 'publish'
      : 'unpublish';
    const statusBefore = mapStatusToTracking(system.status);
    const isDefaultBefore = system.id === selectedId;
    let succeeded = false;
    let errorCode: string | undefined;
    try {
      const updated = await updateDesignSystemDraft(system.id, {
        status: willPublish ? 'published' : 'draft',
      });
      succeeded = Boolean(updated);
      if (!succeeded) errorCode = 'DS_STATUS_UPDATE_RETURNED_NULL';
      await refreshSystems();
    } catch (err) {
      errorCode = err instanceof Error
        ? `DS_STATUS_UPDATE_THREW:${err.message.slice(0, 80)}`
        : 'DS_STATUS_UPDATE_THREW';
      throw err;
    } finally {
      setBusyId(null);
      trackDesignSystemStatusResult(analytics.track, {
        page_name: 'design_systems',
        area: 'design_system_status',
        action,
        result: succeeded ? 'success' : 'failed',
        design_system_id: system.id,
        status_before: statusBefore,
        status_after: succeeded
          ? willPublish
            ? 'published'
            : 'draft'
          : statusBefore,
        is_default_before: isDefaultBefore,
        is_default_after: isDefaultBefore,
        error_code: errorCode,
        duration_ms: Math.round(performance.now() - startedAt),
      });
    }
  }

  function deleteSystem(system: DesignSystemSummary) {
    setDeleteModalSystem(system);
  }

  function trackDeleteCancelled(system: DesignSystemSummary) {
    trackDesignSystemStatusResult(analytics.track, {
      page_name: 'design_systems',
      area: 'design_system_status',
      action: 'delete',
      result: 'cancelled',
      design_system_id: system.id,
      status_before: mapStatusToTracking(system.status),
      status_after: mapStatusToTracking(system.status),
      is_default_before: system.id === selectedId,
      is_default_after: system.id === selectedId,
      duration_ms: 0,
    });
  }

  async function performDelete(
    system: DesignSystemSummary,
    force?: boolean,
  ): Promise<{ success: boolean; error?: string }> {
    setBusyId(system.id);
    const startedAt = performance.now();
    const statusBefore = mapStatusToTracking(system.status);
    const wasDefault = system.id === selectedId;
    let succeeded = false;
    let errorCode: string | undefined;
    try {
      const result = await deleteDesignSystemDraft(system.id, force);
      succeeded = result.success;
      if (!succeeded) errorCode = result.error || 'DS_DELETE_FAILED';
      if (succeeded) {
        if (selectedId === system.id) {
          const fallback = systems.find(
            (candidate) =>
              candidate.id !== system.id && isUserSystem(candidate),
          );
          if (fallback) onSelect(fallback.id);
        }
        await refreshSystems();
      }
      return result;
    } catch (err) {
      errorCode =
        err instanceof Error
          ? `DS_DELETE_THREW:${err.message.slice(0, 80)}`
          : 'DS_DELETE_THREW';
      throw err;
    } finally {
      setBusyId(null);
      trackDesignSystemStatusResult(analytics.track, {
        page_name: 'design_systems',
        area: 'design_system_status',
        action: 'delete',
        result: succeeded ? 'success' : 'failed',
        design_system_id: system.id,
        status_before: statusBefore,
        status_after: succeeded ? 'deleted' : statusBefore,
        is_default_before: wasDefault,
        is_default_after: false,
        error_code: errorCode,
        duration_ms: Math.round(performance.now() - startedAt),
      });
    }
  }

  function handleMakeDefaultClick(system: DesignSystemSummary): void {
    const wasDefault = system.id === selectedId;
    const statusBefore = mapStatusToTracking(system.status);
    onSelect(system.id);
    trackDesignSystemStatusResult(analytics.track, {
      page_name: 'design_systems',
      area: 'design_system_status',
      action: wasDefault ? 'unset_default' : 'set_default',
      result: 'success',
      design_system_id: system.id,
      status_before: statusBefore,
      status_after: statusBefore,
      is_default_before: wasDefault,
      is_default_after: !wasDefault,
      duration_ms: 0,
    });
  }

  return (
    <div className="tab-panel design-systems-manager" data-testid="design-systems-tab">
      <div className="ds-manager-tabs">
        <div className="subtab-pill" role="tablist" aria-label={t('dsManager.areaAria')}>
          <button
            type="button"
            role="tab"
            aria-selected={primaryCollection === 'design-system'}
            className={primaryCollection === 'design-system' ? 'active' : ''}
            onClick={() => setPrimaryCollection('design-system')}
          >
            {t('dsManager.tabDesignSystem')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={primaryCollection === 'template'}
            className={primaryCollection === 'template' ? 'active' : ''}
            onClick={() => setPrimaryCollection('template')}
          >
            {t('dsManager.tabTemplate')}
          </button>
        </div>
      </div>

      {primaryCollection === 'design-system' ? (
        <div className="ds-manager-subtabs">
          <div className="ds-tag-tabs" role="tablist" aria-label={t('dsManager.sourceAria')}>
            <button
              type="button"
              role="tab"
              aria-selected={designSystemCollection === 'mine'}
              className={designSystemCollection === 'mine' ? 'active' : ''}
              onClick={() => setDesignSystemCollection('mine')}
            >
              {t('dsManager.yourSystems')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={designSystemCollection === 'official'}
              className={designSystemCollection === 'official' ? 'active' : ''}
              onClick={() => setDesignSystemCollection('official')}
            >
              {t('dsManager.officialPresets')}
            </button>
            {/* <button
              type="button"
              role="tab"
              aria-selected={designSystemCollection === 'enterprise'}
              className={designSystemCollection === 'enterprise' ? 'active' : ''}
              onClick={() => setDesignSystemCollection('enterprise')}
            >
              {t('dsManager.enterprise')}
            </button> */}
          </div>
        </div>
      ) : (
        <div className="ds-manager-subtabs">
          <div className="ds-tag-tabs" role="tablist" aria-label={t('dsManager.templateSourceAria')}>
            <button
              type="button"
              role="tab"
              aria-selected={templateCollection === 'mine'}
              className={templateCollection === 'mine' ? 'active' : ''}
              onClick={() => setTemplateCollection('mine')}
            >
              {t('dsManager.yourTemplates')}
            </button>
            {/* <button
              type="button"
              role="tab"
              aria-selected={templateCollection === 'enterprise'}
              className={templateCollection === 'enterprise' ? 'active' : ''}
              onClick={() => setTemplateCollection('enterprise')}
            >
              {t('dsManager.enterprise')}
            </button> */}
          </div>
        </div>
      )}

      {primaryCollection === 'design-system' && designSystemCollection === 'mine' ? (
        <section className="ds-settings-card" aria-label={t('dsManager.yourSystemsAria')}>
          <div className="ds-settings-card__head">
            <div>
              <span className="ds-manager-eyebrow">{t('dsManager.eyebrowDesignSystems')}</span>
              <h2>{t('dsManager.yourSystemsHeading')}</h2>
            </div>
            <select
              aria-label={t('dsManager.filterAria')}
              value={userFilter}
              onChange={(event) => setUserFilter(event.target.value as UserListFilter)}
            >
              <option value="all">{t('dsManager.filterAll')}</option>
              <option value="published">{t('dsManager.filterPublished')}</option>
              <option value="draft">{t('dsManager.filterDraft')}</option>
            </select>
          </div>
          {/* 
          {onCreate ? (
            <button type="button" className="ds-create-row" onClick={onCreate}>
              <span>
                <strong>{t('dsManager.createTitle')}</strong>
                <small>{t('dsManager.createBody')}</small>
              </span>
              <span className="ds-create-row__action">{t('dsManager.createAction')}</span>
            </button>
          ) : null} */}

          <button type="button" className="ds-create-row" onClick={() => setImportOpen(true)}>
            <span>
              <strong>{t('dsManager.importGitTitle')}</strong>
              <small>{t('dsManager.importGitBody')}</small>
            </span>
            <span className="ds-create-row__action">{t('dsManager.importGitAction')}</span>
          </button>

          {userSystems.length === 0 ? (
            <div className="ds-user-empty">
              {t('dsManager.emptyMine')}
            </div>
          ) : (
            <div className="ds-grid ds-user-grid">
              {userSystems.map((system) => {
                const status = system.status ?? 'draft';
                const canUseInProjects = status === 'published';
                const selected = canUseInProjects && system.id === selectedId;
                const busy = busyId === system.id;
                return (
                  <DesignSystemCard
                    key={system.id}
                    system={system}
                    active={selected}
                    thumbHtml={thumbs[system.id]}
                    onIntersect={() => loadThumb(system.id)}
                    onSelect={() => {
                      if (onOpenSystem) {
                        onOpenSystem(system.id);
                      }
                    }}
                    onPreview={() => onPreview(system.id)}
                    actions={
                      <>
                        {onOpenSystem ? (
                          <button
                            type="button"
                            className="ghost compact"
                            onClick={() => onOpenSystem(system.id)}
                            disabled={busy}
                          >
                            {t('dsManager.edit')}
                          </button>
                        ) : null}
                        {!selected && canUseInProjects ? (
                          <button
                            type="button"
                            className="ghost compact"
                            onClick={() => handleMakeDefaultClick(system)}
                            disabled={busy}
                          >
                            {t('dsManager.makeDefault')}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={`ds-status-toggle ${status === 'published' ? 'is-on' : ''}`}
                          aria-pressed={status === 'published'}
                          onClick={() => void togglePublished(system)}
                          disabled={busy}
                        >
                          <span>{status === 'published' ? t('dsManager.statusPublished') : t('dsManager.statusDraft')}</span>
                          <i aria-hidden />
                        </button>
                        {onOpenSystem ? (
                          <Button
                            size="icon"
                            aria-label={t('dsManager.openSystemAria', { title: system.title })}
                            onClick={() => onOpenSystem(system.id)}
                          >
                            <Icon name="external-link" />
                          </Button>
                        ) : null}
                        <button
                          type="button"
                          className="icon-btn danger"
                          aria-label={t('dsManager.deleteSystemAria', { title: system.title })}
                          onClick={() => void deleteSystem(system)}
                          disabled={busy}
                        >
                          <Icon name="close" />
                        </button>
                      </>
                    }
                  />
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {primaryCollection === 'design-system' && designSystemCollection === 'official' ? (
        <section className="ds-settings-card" aria-label={t('dsManager.presetsAria')}>
          <div className="ds-settings-card__head">
            <div>
              <span className="ds-manager-eyebrow">{t('dsManager.eyebrowLibrary')}</span>
              <h2>{t('dsManager.officialPresets')}</h2>
            </div>
          </div>
          <div className="tab-panel-toolbar ds-manager-toolbar">
            <input
              data-testid="design-systems-search"
              placeholder={t('ds.searchPlaceholder')}
              value={filter}
              onFocus={() => {
                if (searchTrackedRef.current) return;
                searchTrackedRef.current = true;
                trackDesignSystemsTopClick(analytics.track, {
                  page_name: 'design_systems',
                  area: 'design_systems',
                  element: 'search_input',
                });
              }}
              onChange={(e) => setFilter(e.target.value)}
            />
            <select
              data-testid="design-systems-category-select"
              value={category}
              onFocus={() => {
                if (categoryTrackedRef.current) return;
                categoryTrackedRef.current = true;
                trackDesignSystemsTopClick(analytics.track, {
                  page_name: 'design_systems',
                  area: 'design_systems',
                  element: 'search_dropdown',
                });
              }}
              onChange={(e) => setCategory(e.target.value)}
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {renderCategory(c)}
                </option>
              ))}
            </select>
          </div>
          <div
            className="examples-filter-row"
            role="tablist"
            aria-label={t('ds.surfaceLabel')}
          >
            <span className="examples-filter-label">{t('ds.surfaceLabel')}</span>
            {/* Hide chips with no items in the active style/search filter, but
              always keep "all" and the currently selected surface — otherwise a
              transient search could remove the active chip and leave the grid
              filtered with no chip showing aria-selected. */}
            {SURFACE_PILLS.filter(
              (p) => p.value === surfaceFilter || p.value === 'all' || surfaceCounts[p.value] > 0,
            ).map((p) => (
              <button
                key={p.value}
                type="button"
                role="tab"
                aria-selected={surfaceFilter === p.value}
                data-testid={`design-systems-surface-${p.value}`}
                className={`filter-pill ${surfaceFilter === p.value ? 'active' : ''}`}
                onClick={() => {
                  trackDesignSystemsTopClick(analytics.track, {
                    page_name: 'design_systems',
                    area: 'design_systems',
                    element: 'filter_chip',
                    filter_name: p.value,
                  });
                  setSurfaceFilter(p.value);
                }}
              >
                {t(p.labelKey)}
                <span className="filter-pill-count">{surfaceCounts[p.value]}</span>
              </button>
            ))}
          </div>
          {filtered.length === 0 ? (
            <div className="tab-empty" data-testid="design-systems-empty">{t('ds.emptyNoMatch')}</div>
          ) : (
            <div className="ds-grid" data-testid="design-systems-grid">
              {filtered.map((s) => (
                <DesignSystemCard
                  key={s.id}
                  system={s}
                  active={s.id === selectedId}
                  thumbHtml={thumbs[s.id]}
                  onIntersect={() => loadThumb(s.id)}
                  onSelect={() => {
                    trackDesignSystemsTemplateCardClick(analytics.track, {
                      page_name: 'design_systems',
                      area: 'templates_card',
                      element: 'templates_card',
                      templates_id: s.id,
                      templates_type: s.source ?? 'library',
                    });
                    onSelect(s.id);
                  }}
                  onPreview={() => {
                    trackDesignSystemsTemplateCardClick(analytics.track, {
                      page_name: 'design_systems',
                      area: 'templates_card',
                      element: 'templates_card',
                      templates_id: s.id,
                      templates_type: s.source ?? 'library',
                    });
                    onPreview(s.id);
                  }}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}

      {primaryCollection === 'design-system' && designSystemCollection === 'enterprise' ? (
        <ComingSoonPanel
          eyebrow={t('dsManager.eyebrowDesignSystems')}
          title={t('dsManager.enterpriseDsTitle')}
          body={t('dsManager.enterpriseDsBody')}
          comingSoonLabel={t('dsManager.comingSoonBadge')}
        />
      ) : null}

      {primaryCollection === 'template' && templateCollection === 'mine' ? (
        <section className="ds-settings-card ds-templates-card" aria-label={t('dsManager.yourTemplatesAria')}>
          <div className="ds-settings-card__head">
            <div>
              <span className="ds-manager-eyebrow">{t('dsManager.eyebrowTemplates')}</span>
              <h2>{t('dsManager.yourTemplates')}</h2>
            </div>
          </div>
          {templates.length === 0 ? (
            <div className="ds-user-empty">
              {t('dsManager.emptyTemplates')}
            </div>
          ) : (
            <div className="ds-template-list">
              {templates.map((template) => (
                <div className="ds-template-row" key={template.id}>
                  <div>
                    <strong>{template.name}</strong>
                    <span>{template.description?.trim() || t('dsManager.templateDescFallback')}</span>
                  </div>
                  <small>{formatShortDate(template.createdAt)}</small>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {primaryCollection === 'template' && templateCollection === 'enterprise' ? (
        <ComingSoonPanel
          eyebrow={t('dsManager.eyebrowTemplates')}
          title={t('dsManager.enterpriseTplTitle')}
          body={t('dsManager.enterpriseTplBody')}
          comingSoonLabel={t('dsManager.comingSoonBadge')}
        />
      ) : null}

      <GitImportModal
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        onSystemsRefresh={onSystemsRefresh}
        onOpenSettings={onOpenSettings}
      />

      <DeleteSystemModal
        isOpen={!!deleteModalSystem}
        system={deleteModalSystem}
        onClose={() => setDeleteModalSystem(null)}
        onConfirmDelete={performDelete}
        onCancel={trackDeleteCancelled}
      />
    </div>
  );
}

function ComingSoonPanel({
  eyebrow,
  title,
  body,
  comingSoonLabel,
}: {
  eyebrow: string;
  title: string;
  body: string;
  comingSoonLabel: string;
}) {
  return (
    <section className="ds-settings-card ds-coming-soon-card" aria-label={title}>
      <div className="ds-settings-card__head">
        <div>
          <span className="ds-manager-eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        <span className="ds-coming-soon-badge">{comingSoonLabel}</span>
      </div>
      <div className="ds-user-empty">{body}</div>
    </section>
  );
}

interface CardProps {
  system: DesignSystemSummary;
  active: boolean;
  thumbHtml: string | null | undefined;
  onIntersect: () => void;
  onSelect: () => void;
  onPreview: () => void;
  actions?: React.ReactNode;
}

function DesignSystemCard({
  system,
  active,
  thumbHtml,
  onIntersect,
  onSelect,
  onPreview,
  actions,
}: CardProps) {
  const { locale, t } = useI18n();
  const ref = useRef<HTMLDivElement | null>(null);

  // Lazy-load the showcase iframe only when the card scrolls into the
  // viewport. With ~120 design systems we can't afford to mount every
  // iframe up front — even with `loading="lazy"`, srcDoc iframes ignore
  // the native lazy hint, so we gate via IntersectionObserver.
  useEffect(() => {
    if (thumbHtml !== undefined) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      onIntersect();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            onIntersect();
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [thumbHtml, onIntersect]);

  const localizedSummary = localizeDesignSystemSummary(locale, system);
  const categoryLabel = localizeDesignSystemCategory(
    locale,
    system.category || 'Uncategorized',
  );

  return (
    <div
      ref={ref}
      className={`ds-card ${active ? 'active' : ''}`}
      role="button"
      tabIndex={0}
      data-testid={`design-system-card-${system.id}`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div
        className="ds-card-thumb"
        data-testid={`design-system-preview-${system.id}`}
        onClick={(e) => {
          e.stopPropagation();
          onPreview();
        }}
        title={t('ds.previewTitle')}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            onPreview();
          }
        }}
      >
        {thumbHtml ? (
          <iframe
            title={`${system.title} preview`}
            sandbox="allow-scripts"
            srcDoc={buildSrcdoc(thumbHtml)}
            tabIndex={-1}
            aria-hidden
          />
        ) : (
          <div className="ds-card-thumb-fallback" aria-hidden>
            {system.swatches && system.swatches.length > 0 ? (
              <div className="ds-card-thumb-swatches">
                {system.swatches.map((c, i) => (
                  <span key={i} style={{ background: c }} />
                ))}
              </div>
            ) : (
              <span className="ds-card-thumb-placeholder">
                {thumbHtml === null ? '' : ''}
              </span>
            )}
          </div>
        )}
        <span className="ds-card-thumb-overlay" aria-hidden>
          {t('ds.preview')}
        </span>
      </div>
      <div className="ds-card-meta" data-testid={`design-system-select-${system.id}`}>
        <div className="ds-card-title-row">
          <span className="ds-card-title">{system.title}</span>
          {active ? (
            <span className="ds-card-badge">{t('ds.badgeDefault')}</span>
          ) : null}
        </div>
        <div className="ds-card-summary">{localizedSummary}</div>
        <div className="ds-card-footer">
          <span className="ds-card-category">{categoryLabel}</span>
          {system.swatches && system.swatches.length > 0 ? (
            <div className="ds-card-swatches" aria-hidden>
              {system.swatches.map((c, i) => (
                <span key={i} style={{ background: c }} title={c} />
              ))}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div
            className="ds-card-actions"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function GitImportModal({
  isOpen,
  onClose,
  onSystemsRefresh,
  onOpenSettings,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSystemsRefresh?: () => Promise<void> | void;
  onOpenSettings?: (section?: any) => void;
}) {
  const { t } = useI18n();
  const [importUrl, setImportUrl] = useState('');
  const [importMode] = useState<'normalized' | 'hybrid' | 'verbatim'>('hybrid');
  const [craftApplies, setCraftApplies] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState<string | null>(null);

  const { githubAuth, refreshGitState } = useProjectGit();
  const [showManualInput, setShowManualInput] = useState(false);

  useEffect(() => {
    if (isOpen) {
      void refreshGitState();

      // Reset states
      setImportUrl('');
      setImportError(null);
      setCurrentStage(null);
      setImporting(false);
    }
  }, [isOpen, refreshGitState]);

  useEffect(() => {
    if (isOpen && githubAuth && !githubAuth.connected) {
      setShowManualInput(true);
    }
  }, [isOpen, githubAuth]);

  if (!isOpen) return null;

  async function handleGitImport(e: React.FormEvent) {
    e.preventDefault();
    const targetUrl = importUrl.trim();
    if (!targetUrl || importing) return;
    setImporting(true);
    setImportError(null);
    setCurrentStage('Initializing import...');
    try {
      const result = await importGitDesignSystemStream(
        {
          gitUrl: targetUrl,
          importMode,
          craftApplies,
        },
        (stage) => {
          setCurrentStage(stage);
        }
      );

      if (result && 'error' in result) {
        setImportError(result.error.message);
        setCurrentStage(null);
      } else {
        setImportUrl('');
        setCraftApplies([]);
        setCurrentStage(null);
        await onSystemsRefresh?.();
        onClose();
      }
    } catch (err: any) {
      setImportError(err.message || 'Import failed');
      setCurrentStage(null);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="modal-backdrop ds-import-from-git" onClick={() => { if (!importing) onClose(); }}>
      <form
        className="modal"
        style={{ maxWidth: '480px', width: '100%', display: 'flex', flexDirection: 'column', gap: '16px', padding: '24px' }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleGitImport}
      >
        <h2 style={{ margin: 0, fontSize: '18px' }}>{t('dsManager.importGitTitle')}</h2>

        {!githubAuth?.connected ? (
          <div style={{ padding: '12px', background: 'var(--bg-muted)', borderRadius: '6px', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-soft)' }}>
              <Icon name="github" size={14} style={{ marginRight: 8, verticalAlign: 'middle' }} />
              {t('github.notConnected')}
            </span>
            <button
              type="button"
              className="ghost compact"
              onClick={() => {
                onClose();
                onOpenSettings?.('github');
              }}
            >
              {t('github.connect')}
            </button>
          </div>
        ) : null}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
              {t('settings.designSystemsGitUrl')}
            </label>
            {githubAuth?.connected && (
              <button
                type="button"
                className="ghost compact"
                style={{ fontSize: '11px', padding: '2px 6px', minHeight: 'auto' }}
                onClick={() => setShowManualInput(!showManualInput)}
              >
                {showManualInput ? t('github.pickRepository') : t('github.pasteUrlInstead')}
              </button>
            )}
          </div>

          {showManualInput || !githubAuth?.connected ? (
            <input
              type="text"
              className="library-import-input"
              style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg)' }}
              placeholder="https://example.com/owner/repo.git"
              value={importUrl}
              autoFocus
              disabled={importing}
              onChange={(e) => setImportUrl(e.target.value)}
            />
          ) : (
            <GitHubRepoSelect
              value={importUrl}
              onChange={setImportUrl}
              placeholder={t('github.repoSelect.placeholder')}
              disabled={importing}
              menuClassName={styles.selectMenu}
              ariaLabel={t('github.repoSelect.placeholder')}
            />
          )}
        </div>

        {importing && currentStage ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '16px',
            background: 'var(--bg-muted)',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            marginTop: '8px',
          }}>
            <Icon name="spinner" size={16} className="spin" style={{ color: 'var(--primary)', flexShrink: 0 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-soft)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('github.importing')}
              </span>
              <span style={{ fontSize: '13px', color: 'var(--text)', fontWeight: 500 }}>
                {currentStage}
              </span>
            </div>
          </div>
        ) : null}

        {importError ? (
          <p className="library-install-error" style={{ margin: 0, color: 'var(--danger)', fontSize: '13px' }}>
            {importError}
          </p>
        ) : null}

        <div className="row" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
          <button
            type="button"
            disabled={importing}
            onClick={onClose}
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className="primary"
            disabled={importing || !importUrl.trim()}
          >
            {importing ? t('settings.libraryLoading') : t('dsManager.importGitAction')}
          </button>
        </div>
      </form>
    </div>
  );
}

function DeleteSystemModal({
  isOpen,
  system,
  onClose,
  onConfirmDelete,
  onCancel,
}: {
  isOpen: boolean;
  system: DesignSystemSummary | null;
  onClose: () => void;
  onConfirmDelete: (
    system: DesignSystemSummary,
    force?: boolean,
  ) => Promise<{ success: boolean; error?: string }>;
  onCancel: (system: DesignSystemSummary) => void;
}) {
  const { t } = useI18n();
  const [deleting, setDeleting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setDeleting(false);
      setIsDirty(false);
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen || !system) return null;

  const handleClose = () => {
    if (deleting) return;
    onCancel(system);
    onClose();
  };

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const result = await onConfirmDelete(system, isDirty);
      if (result.success) {
        onClose();
      } else if (result.error === 'GIT_DIRTY') {
        setIsDirty(true);
      } else {
        setError(result.error || 'Delete failed');
      }
    } catch (err: any) {
      setError(err.message || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={handleClose}>
      <form
        className="modal"
        style={{
          maxWidth: '440px',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          padding: '24px',
        }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleDelete}
      >
        <h2
          style={{
            margin: 0,
            fontSize: '18px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <Icon name="alert-triangle" size={20} style={{ color: 'var(--danger)' }} />
          {t('dsManager.deleteModalTitle')}
        </h2>

        {!isDirty ? (
          <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.5 }}>
            {t('dsManager.deleteModalConfirm', { title: system.title })}
          </p>
        ) : (
          <div
            style={{
              padding: '12px 16px',
              background: 'color-mix(in srgb, var(--danger, #ff6b6b) 10%, var(--bg-muted))',
              border: '1px solid color-mix(in srgb, var(--danger, #ff6b6b) 30%, var(--border))',
              borderRadius: '6px',
              fontSize: '13px',
              color: 'var(--danger, #ff6b6b)',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Icon name="alert-triangle" size={14} />
              {t('dsManager.deleteModalDirtyTitle')}
            </span>
            <span style={{ color: 'var(--text)' }}>
              {t('dsManager.deleteModalDirtyWarning')}
            </span>
          </div>
        )}

        {deleting && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              color: 'var(--text-soft)',
              fontSize: '13px',
            }}
          >
            <Icon name="spinner" size={14} className="spin" />
            <span>{t('common.loading')}</span>
          </div>
        )}

        {error && (
          <p style={{ margin: 0, color: 'var(--danger)', fontSize: '13px' }}>
            {error}
          </p>
        )}

        <div
          className="row"
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px',
            marginTop: '12px',
          }}
        >
          <button type="button" disabled={deleting} onClick={handleClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="primary danger" disabled={deleting}>
            {isDirty ? t('dsManager.deleteModalForceDelete') : t('common.delete')}
          </button>
        </div>
      </form>
    </div>
  );
}

