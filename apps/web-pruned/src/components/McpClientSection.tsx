// External MCP servers panel.
//
// Open Design connects to the configured servers as a CLIENT and surfaces
// their tools to the underlying agent.
// This panel is the user-facing form; persistence flows through
// `state/mcp.ts` -> daemon `/api/mcp/servers`.

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAnalytics } from '../analytics/provider';
import { trackIntegrationsMcpTabClick } from '../analytics/events';
import {
  fetchMcpServers,
  fetchMcpOAuthStatus,
  saveMcpServers,
  suggestMcpServerId,
  startMcpOAuth,
  disconnectMcpOAuth,
} from '../state/mcp';
import type {
  McpAuthMode,
  McpServerConfig,
  McpOAuthStatusResponse,
  McpTransport,
} from '../state/mcp';
import { Icon } from './Icon';
import { useT } from '../i18n';

interface Props {
  onServersChanged?: (servers: McpServerConfig[]) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export interface McpClientSectionHandle {
  save: () => Promise<boolean>;
  hasDirty: () => boolean;
}

interface DraftRow extends McpServerConfig {
  _isNew?: boolean;
  _envText?: string;
  _headersText?: string;
  _localId: string;
}

// Draft state for the "Add server" wizard form
interface WizardDraft {
  id: string;
  transport: McpServerConfig['transport'];
  authMode?: McpAuthMode;
  command: string;
  args: string;
  url: string;
  envText: string;
  headersText: string;
}

let NEXT_LOCAL_ID = 1;
function genLocalId(): string {
  return `mcp-row-${NEXT_LOCAL_ID++}`;
}

function isLoopbackMcpUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const host = new URL(rawUrl)
      .hostname
      .replace(/^\[|\]$/g, '')
      .toLowerCase()
      .replace(/\.+$/g, '');
    if (host === 'localhost' || host === '::1') return true;
    if (/^127(?:\.\d{1,3}){3}$/.test(host)) return true;
    return /^::ffff:127(?:\.\d{1,3}){3}$/i.test(host);
  } catch {
    return false;
  }
}

function inferMcpAuthMode(url: string | undefined): NonNullable<McpServerConfig['authMode']> {
  return isLoopbackMcpUrl(url) ? 'none' : 'oauth';
}

function effectiveMcpAuthMode(
  row: Pick<McpServerConfig, 'transport' | 'url' | 'authMode'>,
): NonNullable<McpServerConfig['authMode']> {
  if (row.transport !== 'http') return 'none';
  return row.authMode ?? inferMcpAuthMode(row.url);
}

function authModeAfterUrlChange(
  row: Pick<McpServerConfig, 'url' | 'authMode'>,
  nextUrl: string,
): NonNullable<McpServerConfig['authMode']> {
  const previousInferred = inferMcpAuthMode(row.url);
  if (!row.authMode || row.authMode === previousInferred) {
    return inferMcpAuthMode(nextUrl);
  }
  return row.authMode;
}

function McpConfigFields({
  id,
  transport,
  authMode,
  command,
  args,
  envText,
  url,
  headersText,
  onChange,
  idRef,
}: {
  id: string;
  transport: McpTransport;
  authMode?: McpAuthMode;
  command?: string;
  args?: string;
  envText?: string;
  url?: string;
  headersText?: string;
  onChange: (patch: Record<string, unknown>) => void;
  idRef?: React.Ref<HTMLInputElement>;
}) {
  return (
    <>
      <div className="mcp-row-grid">
        <label className="mcp-row-field">
          <span className="mcp-row-field-label">Server ID</span>
          <input
            ref={idRef ?? undefined}
            type="text"
            value={id}
            onChange={(e) => onChange({ id: e.target.value })}
            placeholder="my-server"
            spellCheck={false}
          />
        </label>
        <label className="mcp-row-field">
          <span className="mcp-row-field-label">Transport</span>
          <select
            value={transport}
            onChange={(e) => {
              const t = e.target.value as McpTransport;
              const patch: Record<string, unknown> = { transport: t };
              if (t === 'http') {
                patch.authMode = authMode ?? inferMcpAuthMode(url);
              } else {
                patch.authMode = undefined;
              }
              onChange(patch);
            }}
          >
            <option value="stdio">stdio</option>
            <option value="http">HTTP</option>
          </select>
        </label>
      </div>

      {transport === 'stdio' ? (
        <>
          <label className="mcp-row-field mcp-row-field-stack">
            <span className="mcp-row-field-label">Command</span>
            <input
              type="text"
              value={command ?? ''}
              onChange={(e) => onChange({ command: e.target.value })}
              placeholder="e.g. npx, node, /usr/local/bin/my-server"
              spellCheck={false}
            />
          </label>
          <label className="mcp-row-field mcp-row-field-stack">
            <span className="mcp-row-field-label">Args <span className="mcp-row-field-hint">(space-separated)</span></span>
            <input
              type="text"
              value={args ?? ''}
              onChange={(e) => onChange({ args: e.target.value })}
              placeholder="-y @modelcontextprotocol/server-filesystem /path/to/dir"
              spellCheck={false}
            />
          </label>
          <label className="mcp-row-field mcp-row-field-stack">
            <span className="mcp-row-field-label">Env <span className="mcp-row-field-hint">(KEY=VALUE, one per line)</span></span>
            <textarea
              rows={3}
              value={envText ?? ''}
              onChange={(e) => onChange({ envText: e.target.value })}
              placeholder="GITHUB_TOKEN=ghp_&#x2026;"
              spellCheck={false}
            />
          </label>
        </>
      ) : (
        <>
          <label className="mcp-row-field mcp-row-field-stack">
            <span className="mcp-row-field-label">OAuth mode</span>
            <select
              value={authMode ?? inferMcpAuthMode(url)}
              onChange={(e) =>
                onChange({ authMode: e.target.value as NonNullable<McpAuthMode> })
              }
            >
              <option value="none">No managed OAuth</option>
              <option value="oauth">Managed OAuth</option>
            </select>
          </label>
          <label className="mcp-row-field mcp-row-field-stack">
            <span className="mcp-row-field-label">URL</span>
            <input
              type="text"
              value={url ?? ''}
              onChange={(e) => onChange({ url: e.target.value })}
              placeholder="https://mcp.example.com/mcp"
              spellCheck={false}
            />
          </label>
          <label className="mcp-row-field mcp-row-field-stack">
            <span className="mcp-row-field-label">Headers <span className="mcp-row-field-hint">(KEY=VALUE, one per line)</span></span>
            <textarea
              rows={3}
              value={headersText ?? ''}
              onChange={(e) => onChange({ headersText: e.target.value })}
              placeholder="Authorization=Bearer your-token"
              spellCheck={false}
            />
          </label>
        </>
      )}
    </>
  );
}

function rowsFromServers(servers: McpServerConfig[]): DraftRow[] {
  return servers.map((s) => ({
    ...s,
    ...(s.transport === 'http'
      ? { authMode: effectiveMcpAuthMode(s) }
      : {}),
    _envText: s.env ? mapToText(s.env) : '',
    _headersText: s.headers ? mapToText(s.headers) : '',
    _localId: genLocalId(),
  }));
}

function mapToText(m: Record<string, string>): string {
  return Object.entries(m)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

function textToMap(text: string | undefined): Record<string, string> | undefined {
  if (!text) return undefined;
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (!k) continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function rowsToServers(rows: DraftRow[]): McpServerConfig[] {
  return rows.map((r) => {
    const out: McpServerConfig = {
      id: r.id,
      transport: r.transport,
      enabled: r.enabled,
    };
    if (r.label) out.label = r.label;
    if (r.transport === 'stdio') {
      if (r.command) out.command = r.command;
      if (r.args && r.args.length > 0) out.args = r.args;
      const env = textToMap(r._envText);
      if (env) out.env = env;
    } else {
      if (r.url) out.url = r.url;
      const headers = textToMap(r._headersText);
      if (headers) out.headers = headers;
      out.authMode = effectiveMcpAuthMode(r);
    }
    return out;
  });
}

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

function validateRow(r: DraftRow): string | null {
  if (!ID_PATTERN.test(r.id)) {
    return 'ID must start with a letter or digit and only contain letters, digits, dash, or underscore (max 64 chars).';
  }
  if (r.transport === 'stdio') {
    if (!r.command || !r.command.trim()) return 'Command is required for stdio transport.';
  } else {
    if (!r.url || !r.url.trim()) return 'URL is required for HTTP transport.';
    try {
      const parsed = new URL(r.url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return 'URL must use http:// or https://.';
      }
    } catch {
      return 'URL is malformed.';
    }
  }
  return null;
}

function signature(rows: DraftRow[]): string {
  return JSON.stringify(rowsToServers(rows));
}

function emptyWizard(taken: ReadonlySet<string>): WizardDraft {
  return {
    id: suggestMcpServerId('my-server', taken),
    transport: 'stdio',
    authMode: undefined,
    command: '',
    args: '',
    url: '',
    envText: '',
    headersText: '',
  };
}

function wizardToRow(w: WizardDraft): DraftRow {
  return {
    id: w.id,
    transport: w.transport,
    enabled: true,
    command: w.transport === 'stdio' ? w.command : undefined,
    args: w.transport === 'stdio' ? w.args.split(/\s+/).map(s => s.trim()).filter(Boolean) : undefined,
    url: w.transport !== 'stdio' ? w.url : undefined,
    authMode: w.transport !== 'stdio' ? w.authMode ?? inferMcpAuthMode(w.url) : undefined,
    _envText: w.transport === 'stdio' ? w.envText : '',
    _headersText: w.transport !== 'stdio' ? w.headersText : '',
    _localId: genLocalId(),
    _isNew: true,
  };
}

export const McpClientSection = forwardRef<McpClientSectionHandle, Props>(
  function McpClientSection({ onServersChanged, onDirtyChange }, ref) {
    const t = useT();
    const analytics = useAnalytics();
    const [rows, setRows] = useState<DraftRow[]>([]);
    const [savedSig, setSavedSig] = useState<string>('[]');
    const [loaded, setLoaded] = useState(false);
    const [saving, setSaving] = useState(false);
    const [savedAt, setSavedAt] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Wizard state — null = closed, object = open with draft
    const [wizard, setWizard] = useState<WizardDraft | null>(null);
    const [wizardError, setWizardError] = useState<string | null>(null);
    const wizardIdRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      let cancelled = false;
      void (async () => {
        const data = await fetchMcpServers();
        if (cancelled) return;
        if (!data) {
          setError(t('mcpClient.daemonError'));
          setLoaded(true);
          return;
        }
        const fresh = rowsFromServers(data.servers);
        setRows(fresh);
        setSavedSig(signature(fresh));
        setLoaded(true);
      })();
      return () => {
        cancelled = true;
      };
    }, []);

    const dirty = useMemo(() => signature(rows) !== savedSig, [rows, savedSig]);

    useEffect(() => {
      onDirtyChange?.(dirty);
    }, [dirty, onDirtyChange]);

    const updateRow = (idx: number, patch: Partial<DraftRow>) => {
      setRows((curr) => curr.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    };

    const removeRow = (idx: number) => {
      setRows((curr) => curr.filter((_, i) => i !== idx));
    };

    const openWizard = () => {
      const taken = new Set(rows.map((r) => r.id));
      setWizard(emptyWizard(taken));
      setWizardError(null);
      trackIntegrationsMcpTabClick(analytics.track, {
        page_name: 'integrations',
        area: 'mcp_tab',
        element: 'add_server',
      });
      // Focus first field on next tick
      setTimeout(() => wizardIdRef.current?.focus(), 50);
    };

    const closeWizard = () => {
      setWizard(null);
      setWizardError(null);
    };

    // saveRows persists an explicit rows list (allows commitWizard to pass
    // the updated list before React state has flushed).
    const saveRows = async (rowsToSave: DraftRow[]): Promise<boolean> => {
      for (const r of rowsToSave) {
        const err = validateRow(r);
        if (err) {
          setError(`${r.label || r.id}: ${err}`);
          return false;
        }
      }
      setError(null);
      setSaving(true);
      const payload = rowsToServers(rowsToSave);
      const data = await saveMcpServers(payload);
      setSaving(false);
      if (!data) {
        setError(t('mcpClient.saveFailed'));
        return false;
      }
      const fresh = rowsFromServers(data.servers);
      setRows(fresh);
      setSavedSig(signature(fresh));
      setSavedAt(Date.now());
      onServersChanged?.(data.servers);
      return true;
    };

    const commitWizard = () => {
      if (!wizard) return;
      // Validate wizard draft before committing
      const idOk = ID_PATTERN.test(wizard.id);
      if (!idOk) {
        setWizardError('ID must start with a letter or digit and contain only letters, digits, dash, or underscore.');
        return;
      }
      if (rows.some(r => r.id === wizard.id)) {
        setWizardError(`Server ID "${wizard.id}" is already used. Pick a different name.`);
        return;
      }
      if (wizard.transport === 'stdio' && !wizard.command.trim()) {
        setWizardError('Command is required for stdio transport.');
        return;
      }
      if (wizard.transport !== 'stdio') {
        if (!wizard.url.trim()) {
          setWizardError('URL is required for HTTP transport.');
          return;
        }
        try {
          const p = new URL(wizard.url);
          if (p.protocol !== 'http:' && p.protocol !== 'https:') throw new Error();
        } catch {
          setWizardError('URL must use http:// or https://.');
          return;
        }
      }
      const newRow = wizardToRow(wizard);
      const nextRows = [...rows, newRow];
      setRows(nextRows);
      setWizard(null);
      setWizardError(null);
      // Save immediately after adding
      void saveRows(nextRows);
    };

    const save = () => saveRows(rows);

    useImperativeHandle(ref, () => ({
      save,
      hasDirty: () => dirty,
    }), [save, dirty]);

    const handleRowSave = () => void save();

    if (!loaded) {
      return (
        <section className="settings-section">
          <div className="section-head">
            <div>
              <h3>{t('mcpClient.title')}</h3>
              <p className="hint">{t('common.loading')}</p>
            </div>
          </div>
        </section>
      );
    }

    return (
      <section className="settings-section">
        <div className="section-head">
          <div>
            <h3>{t('mcpClient.title')}</h3>
            <p className="hint">{t('mcpClient.subtitle')}</p>
          </div>
          <button
            type="button"
            className="primary mcp-add-btn"
            onClick={openWizard}
            disabled={wizard !== null}
          >
            <Icon name="plus" size={13} />
            <span>{t('mcpClient.addServer')}</span>
          </button>
        </div>

        {error ? (
          <div className="mcp-error">{error}</div>
        ) : null}

        {/* ── Add server wizard ── */}
        {wizard !== null && (
          <div className="mcp-wizard">
            <div className="mcp-wizard-header">
              <span className="mcp-wizard-title">Add MCP server</span>
              <button
                type="button"
                className="icon-btn"
                onClick={closeWizard}
                aria-label="Cancel"
              >
                <Icon name="close" size={14} />
              </button>
            </div>

            <McpConfigFields
              id={wizard.id}
              transport={wizard.transport}
              authMode={wizard.authMode}
              command={wizard.command}
              args={wizard.args}
              envText={wizard.envText}
              url={wizard.url}
              headersText={wizard.headersText}
              idRef={wizardIdRef}
              onChange={(patch) => setWizard((prev) => ({ ...prev, ...patch } as WizardDraft))}
            />

            {wizardError ? (
              <div className="mcp-wizard-error">{wizardError}</div>
            ) : null}

            <div className="mcp-wizard-foot">
              <button type="button" className="primary" onClick={commitWizard}>
                Add server
              </button>
              <button type="button" onClick={closeWizard}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {rows.length === 0 && !wizard ? (
          <div className="mcp-empty">
            <div className="mcp-empty-icon">
              <Icon name="puzzle" size={28} />
            </div>
            <strong className="mcp-empty-title">{t('mcpClient.emptyTitle')}</strong>
            <p className="mcp-empty-body">
              Click <strong>Add server</strong> to connect a stdio command or an HTTP endpoint.
            </p>
          </div>
        ) : rows.length > 0 ? (
          <div className="mcp-rows">
            {rows.map((row, idx) => (
              <McpRow
                key={row._localId}
                row={row}
                idx={idx}
                total={rows.length}
                onChange={(patch) => updateRow(idx, patch)}
                onRemove={() => removeRow(idx)}
                onSave={handleRowSave}
                saving={saving}
              />
            ))}
          </div>
        ) : null}

        <div className="mcp-foot">
          {savedAt && !dirty ? (
            <span className="hint mcp-saved-msg">{t('settings.connectorsSaved')}.</span>
          ) : null}
          <span className="mcp-foot-spacer" />
          <span className="hint">
            {t('mcpClient.storedAt')} <code>.od/mcp-config.json</code>
          </span>
        </div>
      </section>
    );
  }
);

interface RowProps {
  row: DraftRow;
  idx: number;
  total: number;
  onChange: (patch: Partial<DraftRow>) => void;
  onRemove: () => void;
  onSave: () => void;
  saving: boolean;
}

function McpRow({ row, idx, total, onChange, onRemove, onSave, saving }: RowProps) {
  const [expanded, setExpanded] = useState<boolean>(false);
  const [toolsExpanded, setToolsExpanded] = useState<boolean>(false);
  // For http/sse servers we probe the daemon OAuth status to determine
  // whether there is a live connection. For stdio servers we treat
  // `enabled` as the connection indicator (daemon doesn't expose per-process
  // liveness for stdio MCP servers).
  const [oauthConnected, setOauthConnected] = useState<boolean | null>(null);

  const isHttpTransport = row.transport === 'http';
  const usesManagedOAuth = isHttpTransport && effectiveMcpAuthMode(row) === 'oauth';
  const summaryTitle = row.label || row.id || 'Unnamed MCP server';

  const [tools, setTools] = useState<string[]>([]);
  const [loadingTools, setLoadingTools] = useState<boolean>(false);
  const [toolsError, setToolsError] = useState<string | null>(null);

  // Probe OAuth status once for HTTP/SSE servers
  useEffect(() => {
    if (!isHttpTransport || !row.enabled || !usesManagedOAuth) {
      setOauthConnected(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const status = await fetchMcpOAuthStatus(row.id);
      if (!cancelled) {
        setOauthConnected(status?.connected ?? false);
      }
    })();
    return () => { cancelled = true; };
  }, [row.id, row.transport, row.enabled, usesManagedOAuth]);

  // Determine status dot state:
  //  - stdio: green when enabled, gray when disabled
  //  - http/sse with no token configured: green when enabled (plain HTTP)
  //  - http/sse with OAuth: green only when oauth token is valid
  const isConnected = isHttpTransport
    ? (usesManagedOAuth ? Boolean(oauthConnected) : row.enabled)
    : row.enabled;

  // Fetch tools dynamically
  useEffect(() => {
    if (!row.enabled || !row.id || row._isNew) {
      setTools([]);
      setToolsError(null);
      return;
    }

    if (isHttpTransport && usesManagedOAuth && !oauthConnected) {
      setTools([]);
      setToolsError(null);
      return;
    }

    let cancelled = false;
    setLoadingTools(true);
    setToolsError(null);

    void (async () => {
      try {
        const res = await fetch(`/api/mcp/servers/tools?serverId=${encodeURIComponent(row.id)}`);
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to fetch tools');
        }
        const data = await res.json();
        if (!cancelled) {
          setTools(data.tools || []);
        }
      } catch (err: any) {
        if (!cancelled) {
          setToolsError(err.message || 'Failed to fetch tools');
          setTools([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingTools(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [row.id, row.enabled, isHttpTransport, usesManagedOAuth, oauthConnected, row._isNew]);

  const hasTools = tools.length > 0;

  return (
    <div className={`mcp-row${row.enabled ? '' : ' mcp-row-disabled'}${expanded ? ' mcp-row-expanded' : ''}`}>
      <div className="mcp-row-head">
        <div className="mcp-row-title-area">
          <span
            className={`mcp-status-dot${isConnected ? ' active' : ''}`}
            title={isConnected ? 'Connected' : 'Not connected'}
          />
          <span className="mcp-row-title">{summaryTitle}</span>
          <span className="mcp-row-summary-transport">{row.transport}</span>
        </div>

        <div className="mcp-row-actions">
          <button
            type="button"
            className={`icon-btn${expanded ? ' active' : ''}`}
            onClick={() => setExpanded((v) => !v)}
            title="Configure"
            aria-label="Configure"
          >
            <Icon name="settings" size={15} />
          </button>
          <button
            type="button"
            className="icon-btn danger"
            onClick={onRemove}
            title="Delete server"
            aria-label="Delete server"
          >
            <Icon name="trash" size={15} />
          </button>
          <label className="toggle-switch toggle-switch-sm">
            <input
              type="checkbox"
              checked={row.enabled}
              onChange={(e) => onChange({ enabled: e.target.checked })}
              aria-label="Enable this MCP server"
            />
            <span className="toggle-slider" />
          </label>
        </div>
      </div>

      <div className="mcp-tools-container">
        {loadingTools ? (
          <span className="mcp-no-tools">Loading tools…</span>
        ) : toolsError ? (
          <span className="mcp-no-tools" style={{ color: 'var(--danger, #ef4444)' }}>
            Error: {toolsError}
          </span>
        ) : hasTools ? (
          <button
            type="button"
            className="mcp-tools-toggle"
            onClick={() => setToolsExpanded((prev) => !prev)}
          >
            <Icon
              name="chevron-down"
              size={12}
              style={{
                transform: toolsExpanded ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.15s ease',
              }}
            />
            <span>{tools.length === 1 ? '1 tool enabled' : `${tools.length} tools enabled`}</span>
          </button>
        ) : (
          <span className="mcp-no-tools">0 tools enabled</span>
        )}

        {toolsExpanded && hasTools && !loadingTools && !toolsError && (
          <div className="mcp-tools-list">
            {tools.map((tool) => (
              <span key={tool} className="mcp-tool-pill">{tool}</span>
            ))}
          </div>
        )}
      </div>

      {expanded && (
        <div className="mcp-row-config-fields">
          {isHttpTransport && !row._isNew && row.id ? (
            usesManagedOAuth ? (
              <McpOAuthControl serverId={row.id} />
            ) : (
              <div className="mcp-oauth-hint hint">
                <strong>No managed OAuth.</strong> Open Design will use this
                server as configured. Add headers below if the server needs a
                token.
              </div>
            )
          ) : null}
          {isHttpTransport && row._isNew && usesManagedOAuth ? (
            <div className="mcp-oauth-hint hint">
              Save first, then click <strong>Connect</strong> to grant Open Design
              access via the provider's OAuth flow.
            </div>
          ) : null}
          {isHttpTransport && row._isNew && !usesManagedOAuth ? (
            <div className="mcp-oauth-hint hint">
              <strong>No managed OAuth.</strong> Save this server and Open Design
              will use it directly.
            </div>
          ) : null}

          <McpConfigFields
            id={row.id}
            transport={row.transport}
            authMode={row.authMode}
            command={row.command ?? ''}
            args={(row.args ?? []).join(' ')}
            envText={row._envText ?? ''}
            url={row.url ?? ''}
            headersText={row._headersText ?? ''}
            onChange={(patch) => {
              const mapped: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(patch)) {
                if (k === 'args') {
                  mapped.args = (v as string).split(/\s+/).map((s) => s.trim()).filter(Boolean);
                } else if (k === 'envText') {
                  mapped._envText = v;
                } else if (k === 'headersText') {
                  mapped._headersText = v;
                } else if (k === 'url') {
                  mapped.url = v;
                  mapped.authMode = authModeAfterUrlChange(row, v as string);
                } else {
                  mapped[k] = v;
                }
              }
              onChange(mapped);
            }}
          />

          <div className="mcp-row-config-foot">
            <button
              type="button"
              className="primary"
              onClick={onSave}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * "Connect" / "Disconnect" panel for an HTTP MCP server.
 *
 * The OAuth flow is fully owned by the daemon — this component just kicks
 * it off (POST /api/mcp/oauth/start), opens the returned authorize URL in
 * a new tab, listens for the postMessage from the callback page, and
 * refreshes the local status badge. There's also a fallback poll every
 * 2 seconds while a connect is pending in case the callback page can't
 * reach back via postMessage (cross-origin tab opener edge cases).
 */
function McpOAuthControl({ serverId }: { serverId: string }) {
  const [status, setStatus] = useState<McpOAuthStatusResponse | null>(null);
  const [busy, setBusy] = useState<'idle' | 'starting' | 'awaiting' | 'disconnecting' | 'refreshing'>('idle');
  const [error, setError] = useState<string | null>(null);
  // Holds the authorize URL while we are waiting on the user to complete
  // OAuth in their browser. Surfaced as a fallback `<a>` so the user can
  // re-open the tab if they accidentally closed it (or if the system
  // browser ate the popup-open call without giving us feedback).
  const [pendingAuthUrl, setPendingAuthUrl] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = async () => {
    const data = await fetchMcpOAuthStatus(serverId);
    if (data) setStatus(data);
    return data;
  };

  useEffect(() => {
    void refresh();
  }, [serverId]);

  // Listen for the postMessage that the callback HTML page emits when the
  // OAuth flow completes. We accept messages from any origin because the
  // callback page is served by THIS daemon, but we still validate the
  // payload shape before reacting to it.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const data = ev.data;
      if (!data || typeof data !== 'object') return;
      if (data.type !== 'mcp-oauth') return;
      if (data.serverId && data.serverId !== serverId) return;
      if (data.ok) {
        setError(null);
        setPendingAuthUrl(null);
        void refresh();
      } else if (typeof data.message === 'string') {
        setError(data.message);
      }
      setBusy('idle');
      stopPoll();
    }
    window.addEventListener('message', onMessage);
    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel('open-design-mcp-oauth');
      bc.onmessage = (ev) => onMessage(ev as MessageEvent);
    }
    return () => {
      window.removeEventListener('message', onMessage);
      if (bc) bc.close();
      stopPoll();
    };
  }, [serverId]);

  function stopPoll() {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }

  function startPoll() {
    stopPoll();
    let elapsed = 0;
    pollTimer.current = setInterval(() => {
      elapsed += 2000;
      void (async () => {
        const data = await refresh();
        // Auto-stop when the daemon reports connected — handles the
        // Electron / system-browser case where postMessage can never
        // reach back across processes, so polling IS the delivery
        // channel for "auth completed" events.
        if (data?.connected) {
          setBusy('idle');
          setError(null);
          setPendingAuthUrl(null);
          stopPoll();
        }
      })();
      // Top out at 5 minutes — same as the daemon-side state cache TTL.
      if (elapsed >= 5 * 60 * 1000) stopPoll();
    }, 2000);
  }

  const onConnect = async () => {
    setError(null);
    setPendingAuthUrl(null);
    setBusy('starting');
    const result = await startMcpOAuth(serverId);
    if (!result.ok) {
      setBusy('idle');
      setError(result.message);
      return;
    }
    setBusy('awaiting');
    setPendingAuthUrl(result.response.authorizeUrl);
    startPoll();
    // Best-effort: try to open the tab automatically.
    try {
      window.open(
        result.response.authorizeUrl,
        '_blank',
        'noopener=no,noreferrer=no',
      );
    } catch {
      // ignore
    }
  };

  // Manual fallback for the user to push when they've completed auth in
  // another tab/window but the postMessage handshake didn't fire (closed
  // opener tab, cross-origin Electron BrowserWindow, etc.).
  const onRefreshStatus = async () => {
    setBusy('refreshing');
    const data = await refresh();
    setBusy('idle');
    if (data?.connected) {
      setError(null);
      setPendingAuthUrl(null);
      stopPoll();
    } else if (busy === 'awaiting' || pendingAuthUrl) {
      // Still pending — keep the awaiting indicator visible so the user
      // knows we're still listening for the callback.
      setBusy('awaiting');
    }
  };

  const onCancelPending = () => {
    setPendingAuthUrl(null);
    setBusy('idle');
    setError(null);
    stopPoll();
  };

  const onDisconnect = async () => {
    setBusy('disconnecting');
    const ok = await disconnectMcpOAuth(serverId);
    setBusy('idle');
    if (ok) {
      setError(null);
      setPendingAuthUrl(null);
      setStatus({ connected: false });
    } else {
      setError('Disconnect failed. Check daemon logs.');
    }
  };

  const connected = Boolean(status?.connected);
  const expiresLabel =
    status?.expiresAt && status.expiresAt > 0
      ? new Date(status.expiresAt).toLocaleString()
      : null;
  const isAwaiting = busy === 'awaiting' || (Boolean(pendingAuthUrl) && !connected);

  return (
    <div className={`mcp-oauth-control${connected ? ' connected' : ''}`}>
      <div className="mcp-oauth-status" aria-live="polite">
        {connected ? (
          <>
            <span className="mcp-oauth-dot mcp-oauth-dot-ok" aria-hidden />
            <span>
              <strong>Connected.</strong>{' '}
              {expiresLabel ? (
                <span className="hint">Token expires {expiresLabel}.</span>
              ) : (
                <span className="hint">Non-expiring token.</span>
              )}
            </span>
          </>
        ) : isAwaiting ? (
          <>
            <span className="mcp-oauth-dot mcp-oauth-dot-pending" aria-hidden />
            <span>
              <strong>Waiting for authorization…</strong>{' '}
              <span className="hint">
                Approve in the browser tab that opened. We'll catch the callback
                automatically — or click Refresh below if you completed it
                already.
              </span>
            </span>
          </>
        ) : (
          <>
            <span className="mcp-oauth-dot" aria-hidden />
            <span>
              <strong>Not connected.</strong>{' '}
              <span className="hint">
                Click Connect to grant Open Design access via the provider's OAuth flow.
              </span>
            </span>
          </>
        )}
      </div>

      <div className="mcp-oauth-actions">
        {connected ? (
          <>
            <button
              type="button"
              className="primary"
              onClick={onConnect}
              disabled={busy !== 'idle' && busy !== 'refreshing'}
              title="Reauthenticate (replaces the existing token)"
            >
              {busy === 'starting' || busy === 'awaiting' ? 'Connecting…' : 'Reconnect'}
            </button>
            <button
              type="button"
              onClick={onRefreshStatus}
              disabled={busy !== 'idle' && busy !== 'refreshing'}
              title="Re-check token status against the daemon"
            >
              {busy === 'refreshing' ? 'Checking…' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={onDisconnect}
              disabled={busy !== 'idle' && busy !== 'refreshing'}
            >
              {busy === 'disconnecting' ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </>
        ) : isAwaiting ? (
          <>
            <button
              type="button"
              className="primary"
              onClick={onRefreshStatus}
              disabled={busy === 'refreshing'}
              title="I've completed authorization — check connection status now"
            >
              {busy === 'refreshing' ? 'Checking…' : 'I’ve approved — Refresh'}
            </button>
            <button type="button" onClick={onCancelPending}>
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="primary"
            onClick={onConnect}
            disabled={busy !== 'idle'}
          >
            {busy === 'starting' ? 'Starting…' : 'Connect'}
          </button>
        )}
      </div>

      {pendingAuthUrl && !connected ? (
        <div className="mcp-oauth-fallback">
          <span className="hint">
            Browser didn't open?{' '}
            <a
              href={pendingAuthUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="md-link"
            >
              Open authorization page
            </a>
            .
          </span>
        </div>
      ) : null}

      {error ? <div className="mcp-oauth-error">{error}</div> : null}
    </div>
  );
}
