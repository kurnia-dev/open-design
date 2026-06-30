// Composed Home view — the top-down layout the entry view renders
// when the left nav rail's "Home" tab is active.
//
// Owns the prompt state + active plugin lifecycle and stitches
// together the smaller pieces (HomeHero, RecentProjectsStrip).
// Replaces the older left-side `PluginLoopHome` surface by lifting its
// plugin orchestration up here so the prompt textarea can live centered in the hero.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  ChatSessionMode,
  ConnectorDetail,
  McpServerConfig,
} from '@open-design/contracts';
import { useAnalytics } from '../analytics/provider';
import {
  trackHomeChatComposerClick,
  trackPageView,
} from '../analytics/events';
import { fetchMcpServers } from '../state/mcp';
import { useI18n } from '../i18n';
import { localizeSkillName } from '../i18n/content';
import { isOpenDesignHostAvailable, pickHostWorkingDir } from '@open-design/host';
import type {
  DesignSystemSummary,
  Project,
  PromptTemplateSummary,
  SkillSummary,
} from '../types';
import { HomeHero, type HomeHeroHandle } from './HomeHero';
import { RecentProjectsStrip } from './RecentProjectsStrip';

const EMPTY_DESIGN_SYSTEMS: DesignSystemSummary[] = [];
const EMPTY_SKILLS: SkillSummary[] = [];
const EMPTY_CONNECTORS: ConnectorDetail[] = [];

interface Props {
  projects: Project[];
  projectsLoading?: boolean;
  designSystems?: DesignSystemSummary[];
  defaultDesignSystemId?: string | null;
  onSubmit: (payload: any) => void;
  onOpenProject: (id: string) => void;
  onViewAllProjects: () => void;
  onOpenIntegrations?: () => void;
  onOpenMcp?: () => void;
  onOpenNewProject?: (tab: 'template') => void;
  skills?: SkillSummary[];
  skillsLoading?: boolean;
  connectors?: ConnectorDetail[];
  promptTemplates?: PromptTemplateSummary[];
  executionSwitcher?: ReactNode;
}

export function HomeView({
  projects,
  projectsLoading,
  designSystems = EMPTY_DESIGN_SYSTEMS,
  defaultDesignSystemId = null,
  onSubmit,
  onOpenProject,
  onViewAllProjects,
  onOpenIntegrations,
  onOpenMcp,
  onOpenNewProject,
  skills = EMPTY_SKILLS,
  skillsLoading = false,
  connectors = EMPTY_CONNECTORS,
  executionSwitcher,
}: Props) {
  const { locale, t } = useI18n();
  const analytics = useAnalytics();

  const homePageViewFiredRef = useRef(false);
  useEffect(() => {
    if (homePageViewFiredRef.current) return;
    homePageViewFiredRef.current = true;
    trackPageView(analytics.track, { page_name: 'home' });
  }, [analytics.track]);

  const [sessionMode, setSessionMode] = useState<ChatSessionMode>('design');
  const [activeSkill, setActiveSkill] = useState<SkillSummary | null>(null);
  const [selectedMcpContexts, setSelectedMcpContexts] = useState<any[]>([]);
  const [selectedConnectorContexts, setSelectedConnectorContexts] = useState<any[]>([]);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [workingDir, setWorkingDir] = useState<string | null>(null);
  const [workingDirToken, setWorkingDirToken] = useState<string | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [mcpLoading, setMcpLoading] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchMcpServers().then((result) => {
      if (cancelled) return;
      setMcpServers(result?.servers ?? []);
      setMcpLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const inputRef = useRef<HomeHeroHandle | null>(null);

  const handlePromptChange = useCallback((value: string) => {
    setPrompt(value);
  }, []);

  const stageFiles = useCallback((files: File[]) => {
    setStagedFiles((prev) => [...prev, ...files]);
  }, []);

  const removeStagedFile = useCallback((index: number) => {
    setStagedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handlePickWorkingDir = useCallback(async () => {
    if (!isOpenDesignHostAvailable()) return;
    try {
      const pick = await pickHostWorkingDir();
      if (pick.ok) {
        setWorkingDir(pick.baseDir);
        setWorkingDirToken(pick.token ?? null);
      }
    } catch (err) {
      console.error('[home] failed to pick working directory:', err);
    }
  }, []);

  const enabledMcpServers = useMemo(
    () => mcpServers.filter((s) => s.enabled),
    [mcpServers],
  );

  const selectableSkills = useMemo(
    () => skills.filter((s) => !s.aggregatesExamples),
    [skills],
  );

  const contextItemCount =
    stagedFiles.length +
    selectedMcpContexts.length +
    selectedConnectorContexts.length +
    (workingDir ? 1 : 0);

  const submit = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed && stagedFiles.length === 0) return;

    trackHomeChatComposerClick(analytics.track, {
      page_name: 'home',
      area: 'chat_composer',
      element: 'send_button',
    });

    const contextMcpServers = selectedMcpContexts.map((item) => ({
      id: item.server.id,
      ...(item.server.label ? { label: item.server.label } : {}),
    }));

    const contextConnectors = selectedConnectorContexts.map((item) => ({
      id: item.connector.id,
      name: item.connector.name,
    }));

    const projectKind = activeSkill ? 'prototype' : 'other';

    onSubmit({
      prompt: trimmed,
      skillId: activeSkill?.id ?? null,
      projectKind,
      contextMcpServers,
      contextConnectors,
      attachments: stagedFiles,
      ...(workingDir ? { workingDir } : {}),
      ...(workingDirToken ? { workingDirToken } : {}),
      conversationMode: sessionMode,
    });

    setSelectedMcpContexts([]);
    setSelectedConnectorContexts([]);
    setStagedFiles([]);
    setPrompt('');
  }, [
    prompt,
    stagedFiles,
    activeSkill,
    selectedMcpContexts,
    selectedConnectorContexts,
    workingDir,
    workingDirToken,
    sessionMode,
    onSubmit,
    analytics.track,
  ]);

  const useSkill = useCallback((skill: SkillSummary) => {
    setActiveSkill(skill);
    setPrompt(skill.examplePrompt ?? '');
  }, []);

  const useMcpServer = useCallback((server: McpServerConfig) => {
    setSelectedMcpContexts((prev) => {
      if (prev.some((x) => x.server.id === server.id)) return prev;
      return [...prev, { server, inlineBacked: false }];
    });
  }, []);

  const useConnector = useCallback((connector: ConnectorDetail) => {
    setSelectedConnectorContexts((prev) => {
      if (prev.some((x) => x.connector.id === connector.id)) return prev;
      return [...prev, { connector, inlineBacked: false }];
    });
  }, []);

  return (
    <div className="home-view" data-testid="home-view">
      <HomeHero
        ref={inputRef}
        prompt={prompt}
        onPromptChange={handlePromptChange}
        onSubmit={submit}
        sessionMode={sessionMode}
        onSessionModeChange={setSessionMode}
        activePluginTitle={null}
        activePluginRecord={null}
        activeSkillId={activeSkill?.id ?? null}
        activeSkillTitle={activeSkill ? localizeSkillName(locale, activeSkill) : null}
        activeChipId={null}
        showActivePluginChip={false}
        onClearActivePlugin={() => {}}
        onClearActiveChip={() => {}}
        onClearActiveSkill={() => setActiveSkill(null)}
        onPickPlugin={() => {}}
        selectedMcpContexts={selectedMcpContexts.map((item) => item.server)}
        selectedConnectorContexts={selectedConnectorContexts.map((item) => item.connector)}
        contextOnlyMcpServers={selectedMcpContexts.map((item) => item.server)}
        contextOnlyConnectors={selectedConnectorContexts.map((item) => item.connector)}
        onRemoveMcpContext={(id) => setSelectedMcpContexts((prev) => prev.filter((x) => x.server.id !== id))}
        onRemoveConnectorContext={(id) => setSelectedConnectorContexts((prev) => prev.filter((x) => x.connector.id !== id))}
        onAddConnector={onOpenIntegrations}
        onAddMcp={onOpenMcp}
        stagedFiles={stagedFiles}
        onAddFiles={stageFiles}
        onRemoveFile={removeStagedFile}
        pluginOptions={[]}
        pluginsLoading={false}
        skillOptions={selectableSkills}
        skillsLoading={skillsLoading}
        mcpOptions={enabledMcpServers}
        mcpLoading={mcpLoading}
        connectorOptions={connectors.filter((connector) => connector.status === 'connected')}
        pendingPluginId={null}
        pendingChipId={null}
        submitDisabled={false}
        onPickSkill={useSkill}
        onPickMcp={useMcpServer}
        onPickConnector={useConnector}
        onPickChip={() => {}}
        contextItemCount={contextItemCount}
        error={error}
        workingDir={workingDir}
        onPickWorkingDir={handlePickWorkingDir}
        onClearWorkingDir={() => {
          setWorkingDir(null);
          setWorkingDirToken(null);
        }}
        executionSwitcher={executionSwitcher}
      />

      <RecentProjectsStrip
        projects={projects}
        designSystems={designSystems}
        {...(projectsLoading !== undefined ? { loading: projectsLoading } : {})}
        onOpen={onOpenProject}
        onViewAll={onViewAllProjects}
      />
    </div>
  );
}
