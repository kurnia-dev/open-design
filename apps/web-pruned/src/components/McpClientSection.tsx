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
} from '../state/mcp';
import type {
  McpServerConfig,
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
  _envText?: string;
  _headersText?: string;
  _localId: string;
}

// Draft state for the "Add server" wizard form
interface WizardDraft {
  id: string;
  transport: McpServerConfig['transport'];
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

function rowsFromServers(servers: McpServerConfig[]): DraftRow[] {
  return servers.map((s) => ({
    ...s,
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
    if (!r.url || !r.url.trim()) return 'URL is required for SSE / HTTP transport.';
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

function getMockToolsForServer(id: string): string[] {
  if (id.toLowerCase().includes('wangs-ui') || id.toLowerCase().includes('wangs')) {
    return [
      'list-all-documentation',
      'get-documentation-for-story',
      'get-documentation'
    ];
  }
  return [];
}

function emptyWizard(taken: ReadonlySet<string>): WizardDraft {
  return {
    id: suggestMcpServerId('my-server', taken),
    transport: 'stdio',
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
    _envText: w.transport === 'stdio' ? w.envText : '',
    _headersText: w.transport !== 'stdio' ? w.headersText : '',
    _localId: genLocalId(),
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
          setWizardError('URL is required for SSE / HTTP transport.');
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

            <div className="mcp-row-grid">
              <label className="mcp-row-field">
                <span className="mcp-row-field-label">Server ID</span>
                <input
                  ref={wizardIdRef}
                  type="text"
                  value={wizard.id}
                  onChange={(e) => setWizard({ ...wizard, id: e.target.value })}
                  placeholder="my-server"
                  spellCheck={false}
                />
              </label>
              <label className="mcp-row-field">
                <span className="mcp-row-field-label">Transport</span>
                <select
                  value={wizard.transport}
                  onChange={(e) => setWizard({ ...wizard, transport: e.target.value as WizardDraft['transport'] })}
                >
                  <option value="stdio">stdio (local command)</option>
                  <option value="sse">SSE (HTTP event stream)</option>
                  <option value="http">streamable HTTP</option>
                </select>
              </label>
            </div>

            {wizard.transport === 'stdio' ? (
              <>
                <label className="mcp-row-field mcp-row-field-stack">
                  <span className="mcp-row-field-label">Command</span>
                  <input
                    type="text"
                    value={wizard.command}
                    onChange={(e) => setWizard({ ...wizard, command: e.target.value })}
                    placeholder="e.g. npx, node, /usr/local/bin/my-server"
                    spellCheck={false}
                  />
                </label>
                <label className="mcp-row-field mcp-row-field-stack">
                  <span className="mcp-row-field-label">Args <span className="mcp-row-field-hint">(space-separated)</span></span>
                  <input
                    type="text"
                    value={wizard.args}
                    onChange={(e) => setWizard({ ...wizard, args: e.target.value })}
                    placeholder="-y @modelcontextprotocol/server-filesystem /path/to/dir"
                    spellCheck={false}
                  />
                </label>
                <label className="mcp-row-field mcp-row-field-stack">
                  <span className="mcp-row-field-label">Env variables <span className="mcp-row-field-hint">(KEY=VALUE, one per line)</span></span>
                  <textarea
                    rows={3}
                    value={wizard.envText}
                    onChange={(e) => setWizard({ ...wizard, envText: e.target.value })}
                    placeholder="GITHUB_TOKEN=ghp_…"
                    spellCheck={false}
                  />
                </label>
              </>
            ) : (
              <>
                <label className="mcp-row-field mcp-row-field-stack">
                  <span className="mcp-row-field-label">URL</span>
                  <input
                    type="text"
                    value={wizard.url}
                    onChange={(e) => setWizard({ ...wizard, url: e.target.value })}
                    placeholder="https://mcp.example.com/mcp"
                    spellCheck={false}
                  />
                </label>
                <label className="mcp-row-field mcp-row-field-stack">
                  <span className="mcp-row-field-label">Headers <span className="mcp-row-field-hint">(KEY=VALUE, one per line)</span></span>
                  <textarea
                    rows={3}
                    value={wizard.headersText}
                    onChange={(e) => setWizard({ ...wizard, headersText: e.target.value })}
                    placeholder="Authorization=Bearer your-token"
                    spellCheck={false}
                  />
                </label>
              </>
            )}

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
              Click <strong>Add server</strong> to connect a stdio command or an HTTP/SSE endpoint.
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

  const isHttpTransport = row.transport === 'http' || row.transport === 'sse';
  const summaryTitle = row.label || row.id || 'Unnamed MCP server';

  // Probe OAuth status once for HTTP/SSE servers
  useEffect(() => {
    if (!isHttpTransport || !row.enabled) {
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
  }, [row.id, row.transport, row.enabled]);

  // Determine status dot state:
  //  - stdio: green when enabled, gray when disabled
  //  - http/sse with no token configured: green when enabled (plain HTTP)
  //  - http/sse with OAuth: green only when oauth token is valid
  const isConnected = isHttpTransport
    ? (oauthConnected === null ? row.enabled : oauthConnected)
    : row.enabled;

  const tools = getMockToolsForServer(row.id);
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
        {hasTools ? (
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

        {toolsExpanded && hasTools && (
          <div className="mcp-tools-list">
            {tools.map((tool) => (
              <span key={tool} className="mcp-tool-pill">{tool}</span>
            ))}
          </div>
        )}
      </div>

      {expanded && (
        <div className="mcp-row-config-fields">
          <div className="mcp-row-grid">
            <label className="mcp-row-field">
              <span className="mcp-row-field-label">ID</span>
              <input
                type="text"
                value={row.id}
                onChange={(e) => onChange({ id: e.target.value })}
                spellCheck={false}
              />
            </label>
            <label className="mcp-row-field">
              <span className="mcp-row-field-label">Transport</span>
              <select
                value={row.transport}
                onChange={(e) => {
                  const transport = e.target.value as DraftRow['transport'];
                  onChange({ transport });
                }}
              >
                <option value="stdio">stdio</option>
                <option value="sse">SSE</option>
                <option value="http">streamable HTTP</option>
              </select>
            </label>
          </div>

          {row.transport === 'stdio' ? (
            <>
              <label className="mcp-row-field mcp-row-field-stack">
                <span className="mcp-row-field-label">Command</span>
                <input
                  type="text"
                  value={row.command ?? ''}
                  placeholder="e.g. npx, node, /path/to/binary"
                  onChange={(e) => onChange({ command: e.target.value })}
                  spellCheck={false}
                />
              </label>
              <label className="mcp-row-field mcp-row-field-stack">
                <span className="mcp-row-field-label">Args</span>
                <input
                  type="text"
                  value={(row.args ?? []).join(' ')}
                  placeholder="space-separated"
                  onChange={(e) =>
                    onChange({
                      args: e.target.value
                        .split(/\s+/)
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  spellCheck={false}
                />
              </label>
              <label className="mcp-row-field mcp-row-field-stack">
                <span className="mcp-row-field-label">Env (KEY=VALUE)</span>
                <textarea
                  rows={Math.max(2, (row._envText ?? '').split('\n').length)}
                  value={row._envText ?? ''}
                  placeholder="GITHUB_TOKEN=ghp_…"
                  onChange={(e) => onChange({ _envText: e.target.value })}
                  spellCheck={false}
                />
              </label>
            </>
          ) : (
            <>
              <label className="mcp-row-field mcp-row-field-stack">
                <span className="mcp-row-field-label">URL</span>
                <input
                  type="text"
                  value={row.url ?? ''}
                  placeholder="https://mcp.higgsfield.ai/mcp"
                  onChange={(e) => {
                    const url = e.target.value;
                    onChange({ url });
                  }}
                  spellCheck={false}
                />
              </label>
              <label className="mcp-row-field mcp-row-field-stack">
                <span className="mcp-row-field-label">Headers (KEY=VALUE)</span>
                <textarea
                  rows={Math.max(2, (row._headersText ?? '').split('\n').length)}
                  value={row._headersText ?? ''}
                  placeholder="Authorization=Bearer …"
                  onChange={(e) => onChange({ _headersText: e.target.value })}
                  spellCheck={false}
                />
              </label>
            </>
          )}

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
