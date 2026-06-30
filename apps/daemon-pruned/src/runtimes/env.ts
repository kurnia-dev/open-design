import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  mergeProxyAwareEnv,
  resolveSystemProxyEnv,
} from "@open-design/platform";
import { resolveProjectRelativePath } from "../home-expansion.js";
import { resolveProjectRootFromNestedModule } from "../project-root.js";
import {
  applySandboxRuntimeEnv,
  isSandboxModeEnabled,
  resolveSandboxRuntimeConfig,
  type SandboxRuntimeConfig,
} from "../sandbox-mode.js";
import { expandConfiguredEnv } from "./paths.js";

type RuntimeEnvMap = NodeJS.ProcessEnv | Record<string, string>;
type SpawnEnvOptions = {
  resolvedBin?: string | null;
};

const RUNTIME_MODULE_PROJECT_ROOT = resolveProjectRootFromNestedModule(
  path.dirname(fileURLToPath(import.meta.url)),
);

export function spawnEnvForAgent(
  agentId: string,
  baseEnv: RuntimeEnvMap,
  configuredEnv: unknown = {},
  systemProxyEnv: RuntimeEnvMap = resolveSystemProxyEnv(),
  options: SpawnEnvOptions = {},
): NodeJS.ProcessEnv {
  const sandboxRuntime = sandboxRuntimeConfigForBaseEnv(baseEnv);
  const env = mergeProxyAwareEnv(
    process.platform,
    systemProxyEnv,
    baseEnv,
    expandConfiguredEnv(configuredEnv),
  );
  if (agentId === "claude") {
    if (!isOpenClaudeExecutable(options.resolvedBin)) {
      stripUnlessCustomBaseUrl(env, "ANTHROPIC_BASE_URL", [
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
      ]);
    }
    return reapplySandboxRuntimeEnv(env, sandboxRuntime);
  }
  if (agentId === "codex") {
    stripUnlessCustomBaseUrl(env, "OPENAI_BASE_URL", [
      "OPENAI_API_KEY",
      "CODEX_API_KEY",
    ]);
    return reapplySandboxRuntimeEnv(env, sandboxRuntime);
  }
  return reapplySandboxRuntimeEnv(env, sandboxRuntime);
}

function isOpenClaudeExecutable(
  resolvedBin: string | null | undefined,
): boolean {
  if (typeof resolvedBin !== "string" || !resolvedBin.trim()) return false;
  const base = path
    .basename(resolvedBin.trim().replace(/\\/g, "/"))
    .replace(/\.(exe|cmd|bat)$/i, "")
    .toLowerCase();
  return base === "openclaude";
}

function sandboxRuntimeConfigForBaseEnv(
  baseEnv: RuntimeEnvMap,
): SandboxRuntimeConfig | null {
  if (!isSandboxModeEnabled(baseEnv)) return null;
  const dataDir = baseEnv.OD_DATA_DIR?.trim();
  if (!dataDir) return null;
  const resolvedDataDir = resolveProjectRelativePath(
    dataDir,
    RUNTIME_MODULE_PROJECT_ROOT,
  );
  return resolveSandboxRuntimeConfig(true, resolvedDataDir);
}

function reapplySandboxRuntimeEnv(
  env: NodeJS.ProcessEnv,
  sandboxRuntime: SandboxRuntimeConfig | null,
): NodeJS.ProcessEnv {
  if (!sandboxRuntime) return env;
  return applySandboxRuntimeEnv(env, sandboxRuntime);
}

// Remove `secretKeys` from `env` unless `baseUrlKey` is set to a non-empty
// value — in which case the user is intentionally routing the CLI through
// a custom endpoint and the secret is the credential that authenticates
// against it. Comparison is case-insensitive so Windows env names with
// mixed casing (`Openai_Api_Key`) cannot slip past a literal `delete`.
function stripUnlessCustomBaseUrl(
  env: NodeJS.ProcessEnv,
  baseUrlKey: string,
  secretKeys: readonly string[],
): void {
  const baseUrlKeyUpper = baseUrlKey.toUpperCase();
  const hasCustomBaseUrl = Object.keys(env).some(
    (k) =>
      k.toUpperCase() === baseUrlKeyUpper &&
      typeof env[k] === "string" &&
      env[k].trim() !== "",
  );
  if (hasCustomBaseUrl) return;
  const secretKeysUpper = new Set(secretKeys.map((k) => k.toUpperCase()));
  for (const key of Object.keys(env)) {
    if (secretKeysUpper.has(key.toUpperCase())) delete env[key];
  }
}
