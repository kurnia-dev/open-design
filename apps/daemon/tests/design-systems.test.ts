import { mkdir, mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exec, spawn } from 'node:child_process';

vi.mock('node:child_process', () => {
  const mockSpawn = vi.fn((cmd, args, opts) => {
    const mockChild: any = {
      stdout: {
        on: vi.fn((event, handler) => {
          if (event === 'data') {
            handler(Buffer.from('mock-stdout'));
          }
        }),
      },
      stderr: {
        on: vi.fn(),
      },
      on: vi.fn((event, handler) => {
        if (event === 'close') {
          setTimeout(() => handler(0), 10);
        }
      }),
    };
    return mockChild;
  });

  return {
    exec: vi.fn((cmd, opts, cb) => {
      const callback = typeof opts === 'function' ? opts : cb;
      if (callback) {
        callback(null, { stdout: 'mock-stdout', stderr: '' });
      }
    }),
    spawn: mockSpawn,
  };
});

import {
  createUserDesignSystem,
  createUserDesignSystemRevision,
  deleteUserDesignSystem,
  linkUserDesignSystemProject,
  listDesignSystems,
  listUserDesignSystemFiles,
  readDesignSystem,
  readUserDesignSystemFile,
  readUserDesignSystemRevision,
  updateUserDesignSystem,
  updateUserDesignSystemRevisionStatus,
} from '../src/design-systems.js';

describe('design systems registry', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'od-design-systems-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('lists bundled design systems as published and non-editable', async () => {
    await mkdir(path.join(root, 'acme'), { recursive: true });
    await writeFile(
      path.join(root, 'acme', 'DESIGN.md'),
      '# Acme\n\n> Category: Custom\n> Surface: web\n\nAcme brand.\n',
    );

    const systems = await listDesignSystems(root);

    expect(systems).toMatchObject([
      {
        id: 'acme',
        title: 'Acme',
        category: 'Custom',
        status: 'published',
        source: 'built-in',
        isEditable: false,
      },
    ]);
  });

  it('creates, updates, reads, and deletes user design systems with prefixed ids', async () => {
    const created = await createUserDesignSystem(root, {
      title: 'Acme Product',
      summary: 'Dense product UI.',
      category: 'Custom',
      status: 'draft',
      provenance: {
        companyBlurb: 'Acme builds dense product UI.',
        githubUrls: ['https://github.com/acme/product'],
        localCodeFiles: ['src/components/Button.tsx'],
        figFiles: ['brand.fig'],
        assetFiles: ['logo.svg'],
        notes: 'Use compact review flows.',
      },
    });

    expect(created.id).toBe('user:acme-product');
    expect(created.source).toBe('user');
    expect(created.isEditable).toBe(true);
    expect(created.status).toBe('draft');
    expect(created.provenance).toMatchObject({
      companyBlurb: 'Acme builds dense product UI.',
      githubUrls: ['https://github.com/acme/product'],
      localCodeFiles: ['src/components/Button.tsx'],
      figFiles: ['brand.fig'],
      assetFiles: ['logo.svg'],
      notes: 'Use compact review flows.',
    });
    const files = await listUserDesignSystemFiles(root, created.id);
    expect(files?.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        'DESIGN.md',
        'README.md',
        'SKILL.md',
        'context/provenance.json',
        'context/provenance.md',
        'colors_and_type.css',
        'preview/colors-primary.html',
        'preview/typography-specimens.html',
        'assets/logo.svg',
        'ui_kits/app/index.html',
        'ui_kits/app/README.md',
        'ui_kits/app/components/App.jsx',
        'ui_kits/app/components/Sidebar.jsx',
        'ui_kits/app/components/AssistantsList.jsx',
        'ui_kits/app/components/ChatArea.jsx',
        'ui_kits/app/components/InputBar.jsx',
        'ui_kits/app/components/MessageBubble.jsx',
      ]),
    );
    await expect(readUserDesignSystemFile(root, created.id, 'ui_kits/app/index.html'))
      .resolves
      .toMatchObject({
        content: expect.stringContaining('ReactDOM.createRoot'),
      });
    await expect(readUserDesignSystemFile(root, created.id, 'ui_kits/app/index.html'))
      .resolves
      .toMatchObject({
        content: expect.stringContaining('components/App.jsx'),
      });
    await expect(readUserDesignSystemFile(root, created.id, 'ui_kits/app/components/App.jsx'))
      .resolves
      .toMatchObject({
        content: expect.stringContaining('<Sidebar'),
      });
    await expect(readUserDesignSystemFile(root, created.id, 'ui_kits/app/components/App.jsx'))
      .resolves
      .toMatchObject({
        content: expect.stringContaining('window.App = App'),
      });
    await expect(readUserDesignSystemFile(root, created.id, 'README.md'))
      .resolves
      .toMatchObject({
        path: 'README.md',
        kind: 'document',
        content: expect.stringContaining('Acme Product'),
      });
    await expect(readUserDesignSystemFile(root, created.id, 'context/provenance.json'))
      .resolves
      .toMatchObject({
        path: 'context/provenance.json',
        kind: 'data',
        content: expect.stringContaining('https://github.com/acme/product'),
      });
    await expect(readUserDesignSystemFile(root, created.id, 'context/provenance.md'))
      .resolves
      .toMatchObject({
        path: 'context/provenance.md',
        kind: 'document',
        content: expect.stringContaining('Acme builds dense product UI.'),
      });
    await expect(readUserDesignSystemFile(root, created.id, '../metadata.json'))
      .resolves
      .toBeNull();

    const linked = await linkUserDesignSystemProject(root, created.id, 'ds-acme-product');
    expect(linked?.projectId).toBe('ds-acme-product');
    await expect(listDesignSystems(root, { idPrefix: 'user:' }))
      .resolves
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: created.id, projectId: 'ds-acme-product' }),
      ]));

    const updated = await updateUserDesignSystem(root, created.id, {
      title: 'Acme Product System',
      status: 'published',
      body: '# Acme Product System\n\n> Category: Custom\n> Surface: web\n\nPublished.\n',
    });

    expect(updated?.status).toBe('published');
    expect(updated?.title).toBe('Acme Product System');
    expect(updated?.projectId).toBe('ds-acme-product');
    await expect(readDesignSystem(root, created.id, { idPrefix: 'user:' }))
      .resolves
      .toContain('Published.');

    await expect(deleteUserDesignSystem(root, created.id)).resolves.toBe(true);
    await expect(listDesignSystems(root, { idPrefix: 'user:' })).resolves.toEqual([]);
  });

  it('rejects traversal ids when reading design systems', async () => {
    await expect(readDesignSystem(root, '../package')).resolves.toBeNull();
    await expect(readDesignSystem(root, 'user:../package', { idPrefix: 'user:' }))
      .resolves
      .toBeNull();
  });

  it('backfills generated files for older user design systems', async () => {
    await mkdir(path.join(root, 'legacy'), { recursive: true });
    await writeFile(
      path.join(root, 'legacy', 'DESIGN.md'),
      '# Legacy System\n\n> Category: Custom\n> Surface: web\n\nLegacy body.\n',
    );

    const files = await listUserDesignSystemFiles(root, 'user:legacy');

    expect(files?.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        'README.md',
        'SKILL.md',
        'context/provenance.json',
        'colors_and_type.css',
        'preview/colors-primary.html',
        'ui_kits/app/components/App.jsx',
        'ui_kits/app/components/Sidebar.jsx',
        'ui_kits/app/components/AssistantsList.jsx',
        'ui_kits/app/components/ChatArea.jsx',
        'ui_kits/app/components/InputBar.jsx',
        'ui_kits/app/components/MessageBubble.jsx',
      ]),
    );
  });

  it('leaves revision acceptance pending when file-change writes fail', async () => {
    const created = await createUserDesignSystem(root, {
      title: 'Atomic Product',
      status: 'draft',
      artifactMode: 'agent-managed',
      body: '# Atomic Product\n\n> Category: Custom\n> Surface: web\n\nOriginal guidance.\n',
    });
    const originalBody = await readDesignSystem(root, created.id, { idPrefix: 'user:' });
    await writeFile(path.join(root, 'atomic-product', 'source'), 'not a directory');

    const revision = await createUserDesignSystemRevision(root, created.id, {
      feedback: 'Rebuild token contract from source evidence.',
      baseBody: originalBody ?? '',
      proposedBody: '# Atomic Product\n\n> Category: Custom\n> Surface: web\n\nAccepted guidance.\n',
      fileChanges: [{
        path: 'source/token-contract.rebuild-request.md',
        baseContent: '',
        proposedContent: '# Token Contract Rebuild Request\n',
      }],
    });

    await expect(updateUserDesignSystemRevisionStatus(
      root,
      created.id,
      revision?.id ?? '',
      'accepted',
    )).rejects.toThrow();

    await expect(readDesignSystem(root, created.id, { idPrefix: 'user:' }))
      .resolves
      .toBe(originalBody);
    await expect(readFile(path.join(root, 'atomic-product', 'source'), 'utf8'))
      .resolves
      .toBe('not a directory');
    await expect(readUserDesignSystemRevision(root, created.id, revision?.id ?? ''))
      .resolves
      .toMatchObject({ status: 'pending' });
  });

  it('migrates older review artifact names into the Claude-style package structure', async () => {
    await mkdir(path.join(root, 'legacy', 'preview'), { recursive: true });
    await mkdir(path.join(root, 'legacy', 'ui_kits', 'generated_interface'), { recursive: true });
    await writeFile(
      path.join(root, 'legacy', 'DESIGN.md'),
      '# Legacy System\n\n> Category: Custom\n> Surface: web\n\nLegacy body.\n',
    );
    await writeFile(
      path.join(root, 'legacy', 'README.md'),
      '# Legacy\n\nReview preview/typography-scale.html and ui_kits/generated_interface/index.html first.\n',
    );
    await writeFile(
      path.join(root, 'legacy', 'SKILL.md'),
      '# Legacy Skill\n\nUse preview/colors-ui-palette.html, preview/spacing-system.html, and ui_kits/generated_interface/.\n',
    );
    await writeFile(path.join(root, 'legacy', 'preview', 'colors-ui-palette.html'), '<!doctype html><html><body>colors</body></html>');
    await writeFile(path.join(root, 'legacy', 'preview', 'colors-node-types.html'), '<!doctype html><html><body>nodes</body></html>');
    await writeFile(path.join(root, 'legacy', 'preview', 'typography-scale.html'), '<!doctype html><html><body>type</body></html>');
    await writeFile(path.join(root, 'legacy', 'preview', 'spacing-system.html'), '<!doctype html><html><body>spacing</body></html>');
    await writeFile(path.join(root, 'legacy', 'preview', 'logo-variants.html'), '<!doctype html><html><body>logo</body></html>');
    await writeFile(
      path.join(root, 'legacy', 'ui_kits', 'generated_interface', 'index.html'),
      '<!doctype html><html><body>legacy app kit</body></html>',
    );

    const files = await listUserDesignSystemFiles(root, 'user:legacy');

    expect(files?.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        'preview/colors-primary.html',
        'preview/colors-theme-light.html',
        'preview/colors-theme-dark.html',
        'preview/typography-specimens.html',
        'preview/spacing-tokens.html',
        'preview/spacing-radius.html',
        'preview/spacing-shadows.html',
        'preview/components-buttons.html',
        'preview/components-inputs.html',
        'preview/brand-assets.html',
        'ui_kits/app/index.html',
        'ui_kits/app/README.md',
        'ui_kits/app/components/App.jsx',
        'ui_kits/app/components/Sidebar.jsx',
        'ui_kits/app/components/AssistantsList.jsx',
        'ui_kits/app/components/ChatArea.jsx',
        'ui_kits/app/components/InputBar.jsx',
        'ui_kits/app/components/MessageBubble.jsx',
      ]),
    );
    expect(files?.map((file) => file.path)).not.toEqual(
      expect.arrayContaining([
        'preview/colors-ui-palette.html',
        'preview/colors-node-types.html',
        'preview/typography-scale.html',
        'preview/spacing-system.html',
        'preview/logo-variants.html',
        'ui_kits/generated_interface/index.html',
      ]),
    );
    await expect(readUserDesignSystemFile(root, 'user:legacy', 'ui_kits/app/index.html'))
      .resolves
      .toMatchObject({
        content: expect.stringContaining('legacy app kit'),
      });
    await expect(readUserDesignSystemFile(root, 'user:legacy', 'README.md'))
      .resolves
      .toMatchObject({
        content: expect.not.stringContaining('ui_kits/generated_interface'),
      });
    await expect(readUserDesignSystemFile(root, 'user:legacy', 'README.md'))
      .resolves
      .toMatchObject({
        content: expect.stringContaining('ui_kits/app/index.html'),
      });
    await expect(readUserDesignSystemFile(root, 'user:legacy', 'SKILL.md'))
      .resolves
      .toMatchObject({
        content: expect.not.stringContaining('preview/colors-ui-palette.html'),
      });
  });

  it('adds modular UI-kit components to existing app kits', async () => {
    await mkdir(path.join(root, 'legacy', 'ui_kits', 'app'), { recursive: true });
    await writeFile(
      path.join(root, 'legacy', 'DESIGN.md'),
      '# Legacy System\n\n> Category: Custom\n> Surface: web\n\nLegacy body.\n',
    );
    await writeFile(path.join(root, 'legacy', 'README.md'), '# Legacy\n');
    await writeFile(path.join(root, 'legacy', 'ui_kits', 'app', 'index.html'), '<!doctype html><html><body>app kit</body></html>');

    const files = await listUserDesignSystemFiles(root, 'user:legacy');

    expect(files?.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        'ui_kits/app/components/App.jsx',
        'ui_kits/app/components/Sidebar.jsx',
        'ui_kits/app/components/AssistantsList.jsx',
        'ui_kits/app/components/ChatArea.jsx',
        'ui_kits/app/components/InputBar.jsx',
        'ui_kits/app/components/MessageBubble.jsx',
      ]),
    );
    await expect(readUserDesignSystemFile(root, 'user:legacy', 'ui_kits/app/components/App.jsx'))
      .resolves
      .toMatchObject({
        content: expect.stringContaining('<Sidebar'),
      });
    await expect(readUserDesignSystemFile(root, 'user:legacy', 'ui_kits/app/components/App.jsx'))
      .resolves
      .toMatchObject({
        content: expect.stringContaining('window.App = App'),
      });
  });

  it('does not backfill agent-managed review artifacts before the agent writes them', async () => {
    const created = await createUserDesignSystem(root, {
      title: 'Agent Managed',
      summary: 'The agent will create review artifacts in the workspace.',
      status: 'draft',
      artifactMode: 'agent-managed',
    });

    const initialFiles = await listUserDesignSystemFiles(root, created.id);

    expect(initialFiles?.map((file) => file.path)).toEqual(['DESIGN.md']);
    expect(initialFiles?.map((file) => file.path)).not.toEqual(expect.arrayContaining(['README.md', 'preview/colors-primary.html']));
    await expect(readUserDesignSystemFile(root, created.id, 'README.md'))
      .resolves
      .toBeNull();

    const contextDir = path.join(root, created.id.slice('user:'.length), 'context');
    await mkdir(contextDir, { recursive: true });
    await writeFile(
      path.join(contextDir, 'source-context.md'),
      '# Source Context\n\nConnector evidence remains available as project context.\n',
      'utf8',
    );

    const generatedFiles = await listUserDesignSystemFiles(root, created.id);

    expect(generatedFiles?.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        'DESIGN.md',
        'context/source-context.md',
      ]),
    );
    expect(generatedFiles?.map((file) => file.path)).not.toEqual(expect.arrayContaining(['README.md']));
  });

  it('triggers build and publish to local npm registry when status transitions to published', async () => {
    const projectsRoot = await mkdtemp(path.join(tmpdir(), 'od-projects-'));
    const projectId = 'ds-acme-publish';
    const projectDir = path.join(projectsRoot, projectId);
    await mkdir(projectDir, { recursive: true });

    const packageDir = path.join(projectDir, 'packages', 'acme-lib');
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      path.join(packageDir, 'package.json'),
      JSON.stringify({ name: '@mystaline/acme-lib', version: '1.0.0' }),
      'utf8'
    );

    const manifestContent = {
      schemaVersion: 'od-design-system-project/v1',
      id: 'acme-publish',
      name: 'Acme Publish',
      category: 'Custom',
      files: {
        design: 'DESIGN.md',
        tokens: 'tokens.css'
      },
      npmPackages: [
        {
          name: '@mystaline/acme-lib',
          buildCommand: 'pnpm run build'
        }
      ]
    };
    await writeFile(path.join(projectDir, 'manifest.json'), JSON.stringify(manifestContent), 'utf8');

    const created = await createUserDesignSystem(root, {
      title: 'Acme Publish',
      status: 'draft',
    });

    await linkUserDesignSystemProject(root, created.id, projectId);

    const mockSpawn = spawn as any;
    mockSpawn.mockClear();

    const updated = await updateUserDesignSystem(
      root,
      created.id,
      { status: 'published' },
      projectsRoot
    );

    expect(updated?.status).toBe('published');

    const calls = mockSpawn.mock.calls.map((c: any) => c[0]);
    expect(calls).toContain('pnpm run build');
    expect(calls).toContain('pnpm --filter @mystaline/acme-lib... publish --no-git-checks');

    const npmrcPath = path.join(packageDir, '.npmrc');
    const npmrcExists = await stat(npmrcPath).then(() => true).catch(() => false);
    expect(npmrcExists).toBe(false);

    await rm(projectsRoot, { recursive: true, force: true });
  });
});
