import { readFileSync } from "node:fs";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function resolveToolsPackRoot(startDir: string): string {
  const maxDepth = 6;
  let current = startDir;

  for (let depth = 0; depth < maxDepth; depth += 1) {
    try {
      const raw = readFileSync(join(current, "package.json"), "utf8");
      const parsed = JSON.parse(raw) as { name?: unknown };
      if (parsed.name === "@open-design/tools-pack") {
        return current;
      }
    } catch {
      // Keep walking until we find the tools-pack package root.
    }

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(
    `tools-pack: unable to resolve package root from ${startDir}`,
  );
}

export const toolsPackRoot = resolveToolsPackRoot(
  dirname(fileURLToPath(import.meta.url)),
);
export const resourcesRoot = join(toolsPackRoot, "resources");

export const macResources = {
  entitlements: join(resourcesRoot, "mac", "entitlements.mac.plist"),
  entitlementsInherit: join(
    resourcesRoot,
    "mac",
    "entitlements.mac.inherit.plist",
  ),
  icon: join(resourcesRoot, "mac", "icon.icns"),
  iconPng: join(resourcesRoot, "mac", "icon.png"),
  notarizeHook: join(resourcesRoot, "mac", "notarize.cjs"),
  webStandaloneAfterPackHook: join(
    resourcesRoot,
    "web-standalone-after-pack.cjs",
  ),
} as const;

export const winResources = {
  icon: join(resourcesRoot, "win", "icon.ico"),
  sevenZipDll: join(resourcesRoot, "win", "7zip", "7z.dll"),
  sevenZipExe: join(resourcesRoot, "win", "7zip", "7z.exe"),
  webStandaloneAfterPackHook: join(
    resourcesRoot,
    "web-standalone-after-pack.cjs",
  ),
} as const;

export const linuxResources = {
  icon: join(resourcesRoot, "linux", "icon.png"),
  desktopTemplate: join(resourcesRoot, "linux", "open-design.desktop.template"),
} as const;

const BUNDLED_RESOURCE_TREES = [
  { from: "skills", to: "skills" },
  // After the skills/design-templates split (specs/current/skills-and-design-templates.md)
  // the rendering catalogue lives under its own root and the daemon
  // resolves it via DESIGN_TEMPLATES_DIR. Bundle it like any other
  // first-class resource so packaged builds carry the full template set.
  { from: "design-templates", to: "design-templates" },
  { from: "design-systems", to: "design-systems" },
  { from: "craft", to: "craft" },
  { from: join("plugins", "_official"), to: join("plugins", "_official") },
  { from: join("plugins", "registry"), to: join("plugins", "registry") },
  { from: join("assets", "frames"), to: "frames" },
  { from: join("assets", "community-pets"), to: "community-pets" },
  { from: "prompt-templates", to: "prompt-templates" },
] as const;

async function copyFiltered(
  src: string,
  dest: string,
  filter: (name: string, isDirectory: boolean) => boolean,
): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const isDir = entry.isDirectory();
    if (filter(entry.name, isDir)) {
      await cp(join(src, entry.name), join(dest, entry.name), {
        recursive: true,
      });
    }
  }
}

export async function copyBundledResourceTrees({
  workspaceRoot,
  resourceRoot,
  pruned = false,
}: {
  workspaceRoot: string;
  resourceRoot: string;
  pruned?: boolean;
}): Promise<void> {
  if (pruned) {
    const allowedSystems = [
      "apple",
      "default",
      "github",
      "minimal",
      "modern",
      "shadcn",
      "sleek",
      "stripe",
      "_schema",
    ];
    const skippedPlugins = ["examples", "video-templates", "image-templates"];

    for (const entry of BUNDLED_RESOURCE_TREES) {
      if (
        entry.from === join("assets", "community-pets") ||
        entry.from === "prompt-templates"
      ) {
        continue;
      }
      if (entry.from === "design-systems") {
        await copyFiltered(
          join(workspaceRoot, "design-systems"),
          join(resourceRoot, "design-systems"),
          (name, isDir) => {
            return !isDir || allowedSystems.includes(name);
          },
        );
        continue;
      }
      if (entry.from === "design-templates") {
        await copyFiltered(
          join(workspaceRoot, "design-templates"),
          join(resourceRoot, "design-templates"),
          (name, isDir) => {
            return (
              !isDir ||
              name.startsWith("web-prototype-") ||
              name.startsWith("mobile-") ||
              name.startsWith("live-")
            );
          },
        );
        continue;
      }
      if (entry.from === join("plugins", "_official")) {
        await copyFiltered(
          join(workspaceRoot, "plugins", "_official"),
          join(resourceRoot, "plugins", "_official"),
          (name, isDir) => {
            return !isDir || !skippedPlugins.includes(name);
          },
        );
        await rm(join(resourceRoot, "plugins", "_official", "design-systems"), {
          force: true,
          recursive: true,
        });
        await copyFiltered(
          join(workspaceRoot, "plugins", "_official", "design-systems"),
          join(resourceRoot, "plugins", "_official", "design-systems"),
          (name, isDir) => {
            return !isDir || allowedSystems.includes(name);
          },
        );
        continue;
      }

      await cp(join(workspaceRoot, entry.from), join(resourceRoot, entry.to), {
        recursive: true,
      });
    }
  } else {
    for (const entry of BUNDLED_RESOURCE_TREES) {
      await cp(join(workspaceRoot, entry.from), join(resourceRoot, entry.to), {
        recursive: true,
      });
    }
  }
}
