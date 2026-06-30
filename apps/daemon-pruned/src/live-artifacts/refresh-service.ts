import {
  appendLiveArtifactRefreshLogEntry,
  commitLiveArtifactRefreshCandidate,
  getLiveArtifact,
  markLiveArtifactRefreshRunning,
  markLiveArtifactRefreshFailed,
  type LiveArtifactStoreRecord,
  withLiveArtifactRefreshLock,
} from "./store.js";
import type {
  BoundedJsonObject,
  LiveArtifactRefreshErrorRecord,
  LiveArtifactRefreshSourceMetadata,
  LiveArtifactSource,
} from "./schema.js";

export interface RefreshLiveArtifactOptions {
  projectsRoot: string;
  projectId: string;
  artifactId: string;
  now?: Date;
  onStarted?: (event: {
    refreshId: string;
    artifact: LiveArtifactStoreRecord["artifact"];
  }) => void | Promise<void>;
}

export interface RefreshLiveArtifactResult {
  artifact: LiveArtifactStoreRecord["artifact"];
  refresh: {
    id: string;
    status: "succeeded";
    refreshedSourceCount: number;
  };
}

export class LiveArtifactRefreshUnavailableError extends Error {
  constructor(message = "No refresh source is available yet.") {
    super(message);
    this.name = "LiveArtifactRefreshUnavailableError";
  }
}

function nowDate(): Date {
  return new Date();
}

function durationMs(startedAt: Date, finishedAt: Date): number {
  return Math.max(0, finishedAt.getTime() - startedAt.getTime());
}

function toRefreshErrorRecord(error: unknown): LiveArtifactRefreshErrorRecord {
  if (error instanceof Error) {
    return error.name === "Error"
      ? { message: error.message }
      : { code: error.name, message: error.message };
  }
  return { message: String(error) };
}

function documentSourceMetadata(
  source: LiveArtifactSource,
): LiveArtifactRefreshSourceMetadata {
  const metadata: LiveArtifactRefreshSourceMetadata = {
    sourceType: "document",
  };
  if (source.toolName !== undefined) metadata.toolName = source.toolName;
  if (source.connector !== undefined) metadata.connector = source.connector;
  return metadata;
}

function isSupportedSource(
  source: LiveArtifactSource | undefined,
): source is LiveArtifactSource {
  if (source === undefined) return false;
  return (
    source.type === "local_file" ||
    source.type === "daemon_tool" ||
    source.type === "connector_tool"
  );
}

function hasRefreshPermission(source: LiveArtifactSource): boolean {
  return source.refreshPermission === "manual_refresh_granted_for_read_only";
}

export async function refreshLiveArtifact(
  options: RefreshLiveArtifactOptions,
): Promise<RefreshLiveArtifactResult> {
  return withLiveArtifactRefreshLock(options, async (lock) => {
    const refreshId = lock.metadata.refreshId;
    let sequence = 0;

    const appendLog = async (entry: {
      step: string;
      status: "running" | "succeeded" | "failed" | "cancelled" | "skipped";
      startedAt: Date;
      finishedAt?: Date;
      source?: LiveArtifactRefreshSourceMetadata;
      error?: unknown;
      metadata?: BoundedJsonObject;
    }): Promise<void> => {
      await appendLiveArtifactRefreshLogEntry({
        projectsRoot: options.projectsRoot,
        projectId: options.projectId,
        artifactId: options.artifactId,
        refreshId,
        sequence: sequence++,
        step: entry.step,
        status: entry.status,
        startedAt: entry.startedAt,
        ...(entry.finishedAt === undefined
          ? {}
          : {
              finishedAt: entry.finishedAt,
              durationMs: durationMs(entry.startedAt, entry.finishedAt),
            }),
        ...(entry.source === undefined ? {} : { source: entry.source }),
        ...(entry.error === undefined
          ? {}
          : { error: toRefreshErrorRecord(entry.error) }),
        ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
      });
    };

    const refreshStartedAt = options.now ?? nowDate();
    await appendLog({
      step: "refresh:start",
      status: "running",
      startedAt: refreshStartedAt,
    });
    const running = await markLiveArtifactRefreshRunning({
      projectsRoot: options.projectsRoot,
      projectId: options.projectId,
      artifactId: options.artifactId,
      refreshId,
      now: refreshStartedAt,
    });
    await options.onStarted?.({ refreshId, artifact: running.artifact });

    try {
      const record = await getLiveArtifact(options);
      const artifact = record.artifact;
      const currentDataJson = artifact.document?.dataJson ?? {};
      const documentSource = artifact.document?.sourceJson;
      const hasDocumentSource = isSupportedSource(documentSource);

      if (!hasDocumentSource) {
        throw new LiveArtifactRefreshUnavailableError();
      }

      if (!hasRefreshPermission(documentSource)) {
        throw new LiveArtifactRefreshUnavailableError(
          "Refresh is disabled for this artifact source.",
        );
      }

      const candidate = { dataJson: currentDataJson };
      const refreshedSourceCount = hasDocumentSource ? 1 : 0;

      const committed = await commitLiveArtifactRefreshCandidate({
        projectsRoot: options.projectsRoot,
        projectId: options.projectId,
        artifactId: options.artifactId,
        refreshId,
        dataJson: candidate.dataJson,
        now: nowDate(),
      });

      const refreshFinishedAt = nowDate();
      await appendLog({
        step: "refresh:commit",
        status: "succeeded",
        startedAt: refreshStartedAt,
        finishedAt: refreshFinishedAt,
        metadata: { refreshedSourceCount },
      });

      return {
        artifact: committed.artifact,
        refresh: { id: refreshId, status: "succeeded", refreshedSourceCount },
      };
    } catch (error) {
      const refreshFinishedAt = nowDate();
      await appendLog({
        step: "refresh:failed",
        status: "failed",
        startedAt: refreshStartedAt,
        finishedAt: refreshFinishedAt,
        error,
      }).catch(() => {});
      await markLiveArtifactRefreshFailed({
        projectsRoot: options.projectsRoot,
        projectId: options.projectId,
        artifactId: options.artifactId,
        refreshId,
        now: refreshFinishedAt,
      }).catch(() => {});
      throw error;
    }
  });
}
