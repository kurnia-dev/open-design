import { execSync } from 'node:child_process';
import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { startServer } from '../src/server.js';

describe('Project Git & GitHub Routes', () => {
  let server: http.Server;
  let baseUrl: string;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function makeTempDir(): string {
    const root = process.env.OD_DATA_DIR || '/tmp';
    const d = fs.mkdtempSync(path.join(root, 'od-git-test-'));
    tempDirs.push(d);
    return d;
  }

  it('connects, gets auth status, and disconnects GitHub account', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation((url, init) => {
      if (url === 'https://api.github.com/user') {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'x-oauth-scopes': 'repo, read:user' }),
          json: () => Promise.resolve({
            login: 'octocat',
            avatar_url: 'https://github.com/images/error/octocat_happy.gif',
          }),
        } as Response);
      }
      return originalFetch(url, init);
    });

    try {
      // 1. Connect
      const connectResp = await fetch(`${baseUrl}/api/github/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'mock-token-123' }),
      });
      expect(connectResp.status).toBe(200);
      const connectBody = (await connectResp.json()) as any;
      expect(connectBody.connected).toBe(true);
      expect(connectBody.username).toBe('octocat');

      // 2. Get status
      const statusResp = await fetch(`${baseUrl}/api/github/auth-status`);
      expect(statusResp.status).toBe(200);
      const statusBody = (await statusResp.json()) as any;
      expect(statusBody.connected).toBe(true);
      expect(statusBody.username).toBe('octocat');
      expect(statusBody.scopes).toEqual(['repo', 'read:user']);

      // 3. Disconnect
      const disconnectResp = await fetch(`${baseUrl}/api/github/disconnect`, {
        method: 'POST',
      });
      expect(disconnectResp.status).toBe(200);

      // 4. Get status again
      const statusResp2 = await fetch(`${baseUrl}/api/github/auth-status`);
      expect(statusResp2.status).toBe(200);
      const statusBody2 = (await statusResp2.json()) as any;
      expect(statusBody2.connected).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('performs remote config, push, pull, and sync status check on git repository', async () => {
    const projectId = `git-test-proj-${Date.now()}`;
    const createResp = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: projectId,
        name: 'Git Test Project',
        skillId: null,
        designSystemId: null,
      }),
    });
    expect(createResp.status).toBe(200);

    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is not set');

    const projectDir = path.join(dataDir, 'projects', projectId);
    fs.mkdirSync(projectDir, { recursive: true });

    // Initialize local project git repository
    execSync('git init', { cwd: projectDir, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: projectDir });
    execSync('git config user.email "test@example.com"', { cwd: projectDir });
    execSync('git checkout -b main', { cwd: projectDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(projectDir, 'test.txt'), 'hello from local');
    execSync('git add test.txt', { cwd: projectDir });
    execSync('git commit -m "initial local commit"', { cwd: projectDir });

    // Initialize remote bare repository
    const remoteDir = makeTempDir();
    execSync('git init --bare', { cwd: remoteDir, stdio: 'ignore' });

    // 1. Get remote URL (should be empty/not configured initially)
    const getRemoteRespEmpty = await fetch(`${baseUrl}/api/projects/${projectId}/git/remote`);
    expect(getRemoteRespEmpty.status).toBe(200);
    const remoteBodyEmpty = (await getRemoteRespEmpty.json()) as any;
    expect(remoteBodyEmpty.remoteUrl).toBeNull();

    // 2. Set remote URL
    const setRemoteResp = await fetch(`${baseUrl}/api/projects/${projectId}/git/remote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remoteUrl: remoteDir }),
    });
    expect(setRemoteResp.status).toBe(200);

    // 3. Get remote URL again
    const getRemoteResp = await fetch(`${baseUrl}/api/projects/${projectId}/git/remote`);
    expect(getRemoteResp.status).toBe(200);
    const remoteBody = (await getRemoteResp.json()) as any;
    expect(remoteBody.remoteUrl).toBe(remoteDir);

    // 4. Push to remote
    const pushResp = await fetch(`${baseUrl}/api/projects/${projectId}/git/push`, {
      method: 'POST',
    });
    expect(pushResp.status).toBe(200);

    // 5. Get sync status (should be in sync since we just pushed)
    const syncResp = await fetch(`${baseUrl}/api/projects/${projectId}/git/sync-status`);
    expect(syncResp.status).toBe(200);
    const syncBody = (await syncResp.json()) as any;
    expect(syncBody.ahead).toBe(0);
    expect(syncBody.behind).toBe(0);

    // 6. Make local change (should show as 1 commit ahead)
    fs.writeFileSync(path.join(projectDir, 'test.txt'), 'hello local update');
    execSync('git add test.txt', { cwd: projectDir });
    execSync('git commit -m "local update commit"', { cwd: projectDir });

    const syncRespAhead = await fetch(`${baseUrl}/api/projects/${projectId}/git/sync-status`);
    expect(syncRespAhead.status).toBe(200);
    const syncBodyAhead = (await syncRespAhead.json()) as any;
    expect(syncBodyAhead.ahead).toBe(1);
    expect(syncBodyAhead.behind).toBe(0);

    // 7. Push local change, then make a change directly on remote to mock a pull requirement
    const pushResp2 = await fetch(`${baseUrl}/api/projects/${projectId}/git/push`, {
      method: 'POST',
    });
    expect(pushResp2.status).toBe(200);

    const cloneTmpDir = makeTempDir();
    execSync(`git clone ${remoteDir} ${cloneTmpDir}`, { stdio: 'ignore' });
    execSync('git config user.name "Remote Test User"', { cwd: cloneTmpDir });
    execSync('git config user.email "remote@example.com"', { cwd: cloneTmpDir });
    fs.writeFileSync(path.join(cloneTmpDir, 'remote-change.txt'), 'remote file content');
    execSync('git add remote-change.txt', { cwd: cloneTmpDir });
    execSync('git commit -m "remote commit"', { cwd: cloneTmpDir });
    execSync('git push origin main', { cwd: cloneTmpDir, stdio: 'ignore' });

    // 8. Check sync status (should now be 1 commit behind)
    const syncRespBehind = await fetch(`${baseUrl}/api/projects/${projectId}/git/sync-status`);
    expect(syncRespBehind.status).toBe(200);
    const syncBodyBehind = (await syncRespBehind.json()) as any;
    expect(syncBodyBehind.ahead).toBe(0);
    expect(syncBodyBehind.behind).toBe(1);

    // 9. Pull remote changes
    const pullResp = await fetch(`${baseUrl}/api/projects/${projectId}/git/pull`, {
      method: 'POST',
    });
    expect(pullResp.status).toBe(200);

    // 10. Check sync status again (should be fully synchronized)
    const syncRespFinal = await fetch(`${baseUrl}/api/projects/${projectId}/git/sync-status`);
    expect(syncRespFinal.status).toBe(200);
    const syncBodyFinal = (await syncRespFinal.json()) as any;
    expect(syncBodyFinal.ahead).toBe(0);
    expect(syncBodyFinal.behind).toBe(0);
    expect(fs.existsSync(path.join(projectDir, 'remote-change.txt'))).toBe(true);
  });
});
