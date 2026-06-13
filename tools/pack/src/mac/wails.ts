import { execFile } from "node:child_process";
import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import type { ToolPackConfig } from "../config.js";
import { resolveMacInstallIdentity } from "./identity.js";
import type { MacPaths } from "./types.js";

const execFileAsync = promisify(execFile);

export async function runWailsBuilder(config: ToolPackConfig, paths: MacPaths): Promise<void> {
  const wailsDir = join(config.workspaceRoot, "apps", "desktop-wails");
  const identity = resolveMacInstallIdentity(config);
  
  process.stderr.write("[tools-pack wails] Syncing wails.json identity...\n");
  const wailsJsonPath = join(wailsDir, "wails.json");
  const wailsJson = JSON.parse(await readFile(wailsJsonPath, "utf8"));
  wailsJson.name = identity.productName;
  wailsJson.outputfilename = identity.executableName;
  if (wailsJson.info) {
    wailsJson.info.outputFilename = identity.executableName;
  }
  await writeFile(wailsJsonPath, JSON.stringify(wailsJson, null, 2), "utf8");
  
  process.stderr.write("[tools-pack wails] Running wails build in apps/desktop-wails...\n");
  
  try {
    await execFileAsync("wails", ["build", "-clean"], {
      cwd: wailsDir,
      env: { ...process.env },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("Wails CLI not found. Please install wails using `go install github.com/wailsapp/wails/v2/cmd/wails@latest`.");
    }
    throw error;
  }

  // wails.json defines outputfilename dynamically now based on identity
  const builtAppBundle = join(wailsDir, "build", "bin", `${identity.executableName}.app`);
  
  await rm(paths.appBuilderOutputRoot, { force: true, recursive: true });
  await mkdir(dirname(paths.appPath), { recursive: true });
  
  // Copy Wails built app bundle to our standard tools-pack output path
  await cp(builtAppBundle, paths.appPath, { recursive: true });

  const resourcesDir = join(paths.appPath, "Contents", "Resources");

  // Copy assembled app into Resources/app
  await cp(paths.assembledAppRoot, join(resourcesDir, "app"), { recursive: true });
  
  // Copy extra resources (like tools-pack does for electron-builder)
  await cp(paths.resourceRoot, join(resourcesDir, "open-design"), { recursive: true });
  
  // Copy packaged config
  await cp(paths.packagedConfigPath, join(resourcesDir, "open-design-config.json"));
  
  process.stderr.write(`[tools-pack wails] Assembled wails app successfully at ${paths.appPath}\n`);
}
