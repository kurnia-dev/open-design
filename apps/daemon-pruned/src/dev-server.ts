import { existsSync, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

const activeDevProcesses = new Map<string, ChildProcess>();

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export function getDevServerUrl(dir: string): string | undefined {
  const manifestPath = path.join(path.resolve(dir), 'manifest.json');
  try {
    if (existsSync(manifestPath)) {
      const content = readFileSync(manifestPath, 'utf8');
      const manifest = JSON.parse(content) as Record<string, any>;
      return manifest.devServer?.url;
    }
  } catch {
    // Ignored
  }
  return undefined;
}

export async function killPortProcesses(port: number) {
  try {
    const { execSync } = await import('node:child_process');
    const pids = new Set<number>();
    if (process.platform === 'win32') {
      try {
        const stdout = execSync('netstat -ano').toString();
        const lines = stdout.split('\n');
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 5 && parts[3] === 'LISTENING') {
            const localAddress = parts[1];
            const pidStr = parts[4];
            if (localAddress && pidStr && localAddress.endsWith(`:${port}`)) {
              const pid = Number(pidStr);
              if (!isNaN(pid) && pid > 0) {
                pids.add(pid);
              }
            }
          }
        }
      } catch (err) {
        console.warn(`[dev-server] Failed to run netstat on Windows:`, err);
      }
    } else {
      try {
        const stdout = execSync(`lsof -t -i:${port}`).toString().trim();
        if (stdout) {
          const lines = stdout.split('\n').map(p => Number(p.trim())).filter(p => !isNaN(p));
          for (const pid of lines) {
            pids.add(pid);
          }
        }
      } catch {
        // Ignored
      }
    }

    if (pids.size > 0) {
      for (const pid of pids) {
        console.log(`[dev-server] Port ${port} is in use by PID ${pid}. Terminating it.`);
        try { process.kill(pid, 'SIGKILL'); } catch { }
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } catch (err) {
    // Ignored
  }
}

export async function stopDevScript(dir: string): Promise<void> {
  const resolvedDir = path.resolve(dir);

  // Kill child process directly if we have a reference to it
  const activeChild = activeDevProcesses.get(resolvedDir);
  if (activeChild) {
    console.log(`[dev-server] Killing active dev process for ${resolvedDir}`);
    activeDevProcesses.delete(resolvedDir);
    if (activeChild.pid) {
      try {
        if (process.platform === 'win32') {
          activeChild.kill('SIGTERM');
        } else {
          process.kill(-activeChild.pid, 'SIGTERM');
        }
      } catch {
        try { activeChild.kill('SIGKILL'); } catch {}
      }
    } else {
      try { activeChild.kill('SIGTERM'); } catch {}
    }
  }

  const manifestPath = path.join(resolvedDir, 'manifest.json');
  if (existsSync(manifestPath)) {
    try {
      const content = readFileSync(manifestPath, 'utf8');
      const manifest = JSON.parse(content) as Record<string, any>;
      if (manifest.devServer?.port) {
        await killPortProcesses(manifest.devServer.port);
      }
    } catch {
      // Ignored
    }
  }
}

/**
 * Starts the `dev` script if present in `package.json`.
 * Spawns it as a detached background process so it continues running.
 */
export async function startDevScript(dir: string): Promise<void> {
  const resolvedDir = path.resolve(dir);
  console.log("Checking package json", resolvedDir)
  const pkgPath = path.join(resolvedDir, 'package.json');
  if (!(await exists(pkgPath))) return;
  console.log("Package json exists")

  // Ensure any existing dev script process for this directory is stopped
  await stopDevScript(resolvedDir);

  // Check manifest.json for existing devServer configuration and terminate whatever is on the port
  const manifestPath = path.join(resolvedDir, 'manifest.json');
  if (existsSync(manifestPath)) {
    try {
      const content = readFileSync(manifestPath, 'utf8');
      const manifest = JSON.parse(content) as Record<string, any>;
      if (manifest.devServer?.port) {
        await killPortProcesses(manifest.devServer.port);
      }
    } catch {
      // Ignored
    }
  }

  try {
    const pkgContent = await readFile(pkgPath, 'utf8');
    const pkg = JSON.parse(pkgContent) as Record<string, any>;
    if (!pkg.scripts || !pkg.scripts.dev) return;

    const pm = 'pnpm';
    console.log(`[dev-server] Starting dev server using pnpm run dev in ${resolvedDir}`);

    const isWindows = process.platform === 'win32';
    const child = spawn(pm, ['run', 'dev'], {
      cwd: resolvedDir,
      detached: !isWindows,
      stdio: ['ignore', 'ignore', 'pipe'],
      shell: isWindows,
      windowsHide: true,
    });

    activeDevProcesses.set(resolvedDir, child);

    child.stderr?.on('data', (chunk) => {
      console.warn(`[dev-server-stderr] ${chunk.toString().trim()}`);
    });

    child.on('close', (code) => {
      console.log(`[dev-server] dev server process for ${resolvedDir} exited with code ${code}`);
      if (activeDevProcesses.get(resolvedDir) === child) {
        activeDevProcesses.delete(resolvedDir);
      }
    });

    (child.stderr as any)?.unref?.();
    child.unref();
  } catch (err) {
    console.warn(
      `[dev-server] Failed to start dev server in ${resolvedDir}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}
