import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  importGitHubDesignSystemProject,
  parseGitHubRepoUrl,
  parseGitRepoUrl,
} from '../src/design-system-github-import.js';

describe('parseGitHubRepoUrl', () => {
  it('normalizes public GitHub repository URLs to clone URLs', () => {
    expect(parseGitHubRepoUrl('https://github.com/acme/design-system')).toEqual({
      owner: 'acme',
      repo: 'design-system',
      cloneUrl: 'https://github.com/acme/design-system.git',
    });
    expect(parseGitHubRepoUrl('https://github.com/acme/design-system.git')).toEqual({
      owner: 'acme',
      repo: 'design-system',
      cloneUrl: 'https://github.com/acme/design-system.git',
    });
  });

  it('rejects non-root or non-GitHub URLs', () => {
    expect(() => parseGitHubRepoUrl('https://example.com/acme/design-system')).toThrow(
      /github\.com/,
    );
    expect(() => parseGitHubRepoUrl('https://github.com/acme/design-system/tree/main')).toThrow(
      /repository root/,
    );
  });
});

describe('parseGitRepoUrl', () => {
  it('parses repo name and clone url', () => {
    expect(parseGitRepoUrl('https://example.com/org/my-style-kit.git')).toEqual({
      cloneUrl: 'https://example.com/org/my-style-kit.git',
      repo: 'my-style-kit',
    });
  });
});

describe('importGitHubDesignSystemProject', () => {
  let tempRoot: string;
  let fixtureRoot: string;
  let tmpRoot: string;
  let userDesignSystemsRoot: string;
  let projectsRoot: string;
  let fakeGit: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'od-ds-github-import-'));
    fixtureRoot = path.join(tempRoot, 'fixture-repo');
    tmpRoot = path.join(tempRoot, '.tmp');
    userDesignSystemsRoot = path.join(tempRoot, 'user-design-systems');
    projectsRoot = path.join(tempRoot, 'projects');
    fs.mkdirSync(path.join(fixtureRoot, 'src', 'components'), { recursive: true });
    fs.mkdirSync(path.join(fixtureRoot, 'src', 'styles'), { recursive: true });
    fs.writeFileSync(
      path.join(fixtureRoot, 'package.json'),
      JSON.stringify({
        name: 'github-design-kit',
        description: 'A GitHub-hosted design kit.',
        dependencies: { react: '^18.0.0' },
      }),
    );
    fs.writeFileSync(path.join(fixtureRoot, 'README.md'), '# GitHub Design Kit\n\nRemote style source.\n');
    fs.writeFileSync(path.join(fixtureRoot, 'src', 'styles', 'tokens.css'), ':root { --primary: #22c55e; }');
    fs.writeFileSync(path.join(fixtureRoot, 'src', 'components', 'Card.tsx'), 'export function Card() {}');

    fakeGit = path.join(tempRoot, 'fake-git.sh');
    fs.writeFileSync(
      fakeGit,
      `#!/bin/sh
set -eu
if [ "$1" = "clone" ]; then
  target=""
  for arg in "$@"; do target="$arg"; done
  mkdir -p "$target"
  cp -R "$FAKE_GIT_SOURCE"/. "$target"/
  exit 0
fi
if [ "$1" = "-C" ] && [ "$3" = "rev-parse" ] && [ "$4" = "--abbrev-ref" ]; then
  printf 'main\\n'
  exit 0
fi
if [ "$1" = "-C" ] && [ "$3" = "rev-parse" ] && [ "$4" = "HEAD" ]; then
  printf 'abc123def456\\n'
  exit 0
fi
echo "unexpected git args: $*" >&2
exit 1
`,
    );
    fs.chmodSync(fakeGit, 0o755);
    process.env.FAKE_GIT_SOURCE = fixtureRoot;
  });

  afterEach(() => {
    delete process.env.FAKE_GIT_SOURCE;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('clones a public GitHub URL and imports through the local project format', async () => {
    const result = await importGitHubDesignSystemProject(
      'https://github.com/acme/design-kit',
      tmpRoot,
      userDesignSystemsRoot,
      {
        gitBin: fakeGit,
        now: new Date('2026-05-18T10:00:00.000Z'),
        importMode: 'normalized',
        craftApplies: ['color'],
        isReferenceOnly: true,
      },
    );

    expect(result.id).toBe('github-design-kit');
    const manifest = JSON.parse(fs.readFileSync(path.join(result.dir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      schemaVersion: 'od-design-system-project/v1',
      id: 'github-design-kit',
      source: {
        type: 'github',
        url: 'https://github.com/acme/design-kit.git',
        branch: 'main',
        commit: 'abc123def456',
        importedAt: '2026-05-18T10:00:00.000Z',
      },
      files: {
        design: 'DESIGN.md',
        tokens: 'tokens.css',
        components: 'components.html',
      },
      usage: 'USAGE.md',
      componentsManifest: 'components.manifest.json',
      importMode: 'normalized',
      craft: {
        applies: ['color'],
      },
      sourceFiles: {
        scanned: 'source/scanned-files.json',
        evidence: 'source/evidence.md',
        tokens: 'source/tokens.source.json',
        report: 'source/token-contract.report.json',
        snippets: 'source/snippets/INDEX.json',
      },
    });
    expect(fs.readFileSync(path.join(result.dir, 'DESIGN.md'), 'utf8')).toContain(
      'A GitHub-hosted design kit.',
    );
    expect(fs.existsSync(path.join(result.dir, 'USAGE.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.dir, 'components.manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(result.dir, 'source', 'token-contract.report.json'))).toBe(true);
    expect(fs.existsSync(path.join(result.dir, 'preview', 'app.html'))).toBe(true);
    expect(fs.existsSync(path.join(result.dir, 'source', 'snippets', 'card.tsx'))).toBe(true);
  });

  it('clones a generic Git URL and imports through the local project format', async () => {
    const result = await importGitHubDesignSystemProject(
      'https://example.com/org/my-style-kit.git',
      tmpRoot,
      userDesignSystemsRoot,
      {
        gitBin: fakeGit,
        now: new Date('2026-05-18T10:00:00.000Z'),
        importMode: 'normalized',
        craftApplies: ['color'],
        isReferenceOnly: true,
      },
    );

    expect(result.id).toBe('github-design-kit');
    const manifest = JSON.parse(fs.readFileSync(path.join(result.dir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      schemaVersion: 'od-design-system-project/v1',
      id: 'github-design-kit',
      source: {
        type: 'git',
        url: 'https://example.com/org/my-style-kit.git',
        branch: 'main',
        commit: 'abc123def456',
        importedAt: '2026-05-18T10:00:00.000Z',
      },
    });
  });

  it('clones a public GitHub URL using githubToken options', async () => {
    const fakeGitSpyPath = path.join(tempRoot, 'git-spy.txt');
    const fakeGitSpy = path.join(tempRoot, 'fake-git-spy.sh');
    fs.writeFileSync(
      fakeGitSpy,
      `#!/bin/sh
set -eu
if [ "$1" = "clone" ]; then
  echo "$@" > "${fakeGitSpyPath}"
  target=""
  for arg in "$@"; do target="$arg"; done
  mkdir -p "$target"
  cp -R "$FAKE_GIT_SOURCE"/. "$target"/
  exit 0
fi
if [ "$1" = "-C" ] && [ "$3" = "rev-parse" ] && [ "$4" = "--abbrev-ref" ]; then
  printf 'main\\n'
  exit 0
fi
if [ "$1" = "-C" ] && [ "$3" = "rev-parse" ] && [ "$4" = "HEAD" ]; then
  printf 'abc123def456\\n'
  exit 0
fi
echo "unexpected git args: $*" >&2
exit 1
`,
    );
    fs.chmodSync(fakeGitSpy, 0o755);

    await importGitHubDesignSystemProject(
      'https://github.com/acme/design-kit',
      tmpRoot,
      userDesignSystemsRoot,
      {
        gitBin: fakeGitSpy,
        githubToken: 'my_secret_token',
        now: new Date('2026-05-18T10:00:00.000Z'),
        importMode: 'normalized',
        craftApplies: ['color'],
        isReferenceOnly: true,
      },
    );

    const spyContents = fs.readFileSync(fakeGitSpyPath, 'utf8');
    expect(spyContents).toContain('https://x-access-token:my_secret_token@github.com/acme/design-kit.git');
  });

  it('splits the repository import when isReferenceOnly is true and manifest exists', async () => {
    // Write manifest to fixture to trigger split logic
    fs.writeFileSync(
      path.join(fixtureRoot, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 'od-design-system-project/v1',
        name: 'manifested-system',
        files: { design: 'README.md' },
      }),
    );

    const result = await importGitHubDesignSystemProject(
      'https://github.com/acme/design-kit',
      tmpRoot,
      userDesignSystemsRoot,
      {
        gitBin: fakeGit,
        now: new Date('2026-05-18T10:00:00.000Z'),
        isReferenceOnly: true,
        projectsRoot,
      },
    );

    expect(result.id).toBe('manifested-system');
    
    // outDir should only contain README.md/manifest.json (docs)
    expect(fs.existsSync(path.join(result.dir, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.dir, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(result.dir, 'package.json'))).toBe(false); // Code file excluded from outDir

    // projectsRoot should contain the full repo
    const projDir = path.join(projectsRoot, `ds-${result.id}`);
    expect(fs.existsSync(path.join(projDir, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(projDir, 'manifest.json'))).toBe(true);
  });

  it('imports the repository as-is, splitting files when manifest exists even if isReferenceOnly is false', async () => {
    // Write manifest to fixture
    fs.writeFileSync(
      path.join(fixtureRoot, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 'od-design-system-project/v1',
        name: 'manifested-system',
        files: { design: 'README.md' },
      }),
    );

    const result = await importGitHubDesignSystemProject(
      'https://github.com/acme/design-kit',
      tmpRoot,
      userDesignSystemsRoot,
      {
        gitBin: fakeGit,
        now: new Date('2026-05-18T10:00:00.000Z'),
        isReferenceOnly: false,
        projectsRoot,
      },
    );

    expect(result.id).toBe('manifested-system');

    // outDir should only contain README.md/manifest.json (docs)
    expect(fs.existsSync(path.join(result.dir, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.dir, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(result.dir, 'package.json'))).toBe(false); // Code file excluded from outDir

    // projectsRoot should contain the full repo
    const projDir = path.join(projectsRoot, `ds-${result.id}`);
    expect(fs.existsSync(path.join(projDir, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(projDir, 'manifest.json'))).toBe(true);
  });

  it('imports the repository fully to outDir when manifest exists but projectsRoot is not provided', async () => {
    // Write manifest to fixture
    fs.writeFileSync(
      path.join(fixtureRoot, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 'od-design-system-project/v1',
        name: 'manifested-system',
        files: { design: 'README.md' },
      }),
    );

    const result = await importGitHubDesignSystemProject(
      'https://github.com/acme/design-kit',
      tmpRoot,
      userDesignSystemsRoot,
      {
        gitBin: fakeGit,
        now: new Date('2026-05-18T10:00:00.000Z'),
        isReferenceOnly: false,
        projectsRoot: undefined,
      },
    );

    expect(result.id).toBe('manifested-system');

    // outDir should contain the full repo
    expect(fs.existsSync(path.join(result.dir, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.dir, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(result.dir, 'package.json'))).toBe(true);
  });

  it('clones a generic Git URL using githubToken options', async () => {
    const fakeGitSpyPath = path.join(tempRoot, 'git-spy-generic.txt');
    const fakeGitSpy = path.join(tempRoot, 'fake-git-spy-generic.sh');
    fs.writeFileSync(
      fakeGitSpy,
      `#!/bin/sh
set -eu
if [ "$1" = "clone" ]; then
  echo "$@" > "${fakeGitSpyPath}"
  target=""
  for arg in "$@"; do target="$arg"; done
  mkdir -p "$target"
  cp -R "$FAKE_GIT_SOURCE"/. "$target"/
  exit 0
fi
if [ "$1" = "-C" ] && [ "$3" = "rev-parse" ] && [ "$4" = "--abbrev-ref" ]; then
  printf 'main\\n'
  exit 0
fi
if [ "$1" = "-C" ] && [ "$3" = "rev-parse" ] && [ "$4" = "HEAD" ]; then
  printf 'abc123def456\\n'
  exit 0
fi
echo "unexpected git args: $*" >&2
exit 1
`,
    );
    fs.chmodSync(fakeGitSpy, 0o755);

    await importGitHubDesignSystemProject(
      'https://gitea.tagsamurai.local/Wangsit-Developer/wangs-ui-react.git',
      tmpRoot,
      userDesignSystemsRoot,
      {
        gitBin: fakeGitSpy,
        githubToken: 'my_secret_gitea_token',
        now: new Date('2026-05-18T10:00:00.000Z'),
        importMode: 'normalized',
        craftApplies: ['color'],
        isReferenceOnly: true,
      },
    );

    const spyContents = fs.readFileSync(fakeGitSpyPath, 'utf8');
    expect(spyContents).toContain('https://oauth2:my_secret_gitea_token@gitea.tagsamurai.local/Wangsit-Developer/wangs-ui-react.git');
  });
});

