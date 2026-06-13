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
  
  process.stderr.write("[tools-pack wails] Syncing config.yml identity...\n");
  const configYmlPath = join(wailsDir, "build", "config.yml");
  let configYml = await readFile(configYmlPath, "utf8");
  configYml = configYml.replace(/productName:\s*".*?"/, `productName: "${identity.productName}"`);
  configYml = configYml.replace(/productIdentifier:\s*".*?"/, `productIdentifier: "${identity.appId}"`);
  await writeFile(configYmlPath, configYml, "utf8");

  const taskfilePath = join(wailsDir, "Taskfile.yml");
  let taskfile = await readFile(taskfilePath, "utf8");
  taskfile = taskfile.replace(/APP_NAME:\s*".*?"/, `APP_NAME: "${identity.executableName}"`);
  await writeFile(taskfilePath, taskfile, "utf8");

  process.stderr.write("[tools-pack wails] Syncing Info.plist build assets...\n");
  try {
    await execFileAsync("wails3", [
      "update",
      "build-assets",
      "-name",
      identity.productName,
      "-binaryname",
      identity.executableName,
      "-config",
      "config.yml",
      "-dir",
      ".",
    ], {
      cwd: join(wailsDir, "build"),
      env: { ...process.env },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("Wails v3 CLI not found. Please install wails3 using `go install github.com/wailsapp/wails/v3/cmd/wails3@latest`.");
    }
    throw error;
  }
  
  process.stderr.write("[tools-pack wails] Running wails3 task package in apps/desktop-wails...\n");
  
  try {
    await execFileAsync("wails3", ["task", "package", `APP_NAME=${identity.executableName}`], {
      cwd: wailsDir,
      env: { ...process.env },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("Wails v3 CLI not found. Please install wails3 using `go install github.com/wailsapp/wails/v3/cmd/wails3@latest`.");
    }
    throw error;
  }

  // Wails v3 packages the app bundle under bin/
  const builtAppBundle = join(wailsDir, "bin", `${identity.executableName}.app`);
  
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
