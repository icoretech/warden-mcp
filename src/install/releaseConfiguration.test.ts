import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { z } from 'zod';

const root = new URL('../../', import.meta.url);
const pluginPath = 'plugins/warden-mcp';
const semver = z.string().regex(/^\d+\.\d+\.\d+$/);

const releaseSchema = z.object({
  'separate-pull-requests': z.boolean().optional(),
  packages: z.object({
    '.': z.object({
      'exclude-paths': z.array(z.string()),
      'include-component-in-tag': z.literal(false),
    }),
    'plugins/warden-mcp': z.object({
      'release-type': z.literal('simple'),
      'include-component-in-tag': z.literal(true),
      component: z.string().min(1),
      'version-file': z.string(),
      'extra-files': z.array(
        z.object({ type: z.string(), path: z.string(), jsonpath: z.string() }),
      ),
      'changelog-sections': z.array(
        z.object({ type: z.string(), hidden: z.boolean().optional() }),
      ),
    }),
  }),
});

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(path, root), 'utf8'));
}

test('plugin releases cannot recursively trigger a server package release', async () => {
  const config = releaseSchema.parse(
    await readJson('release-please-config.json'),
  );

  // Release-please assigns every commit to the root before applying exclusions.
  assert.ok(config.packages['.']['exclude-paths'].includes(pluginPath));
  assert.notEqual(config['separate-pull-requests'], true);
  const visibleTypes = config.packages[pluginPath]['changelog-sections']
    .filter((section) => !section.hidden)
    .map((section) => section.type);
  for (const type of ['feat', 'fix', 'deps', 'docs', 'chore']) {
    assert.ok(
      visibleTypes.includes(type),
      `${type} must release plugin changes`,
    );
  }
});

test('plugin release targets update its version without overwriting its manifest', async () => {
  const config = releaseSchema.parse(
    await readJson('release-please-config.json'),
  );
  const plugin = config.packages[pluginPath];
  const versionFile = `${pluginPath}/${plugin['version-file']}`;
  const manifestPath = '.claude-plugin/plugin.json';
  assert.notEqual(plugin['version-file'], manifestPath);
  assert.ok(
    plugin['extra-files'].some(
      (file) =>
        file.type === 'json' &&
        file.path === manifestPath &&
        file.jsonpath === '$.version',
    ),
    'the plugin manifest must use the JSON version updater',
  );

  const versions = z
    .record(z.string(), semver)
    .parse(await readJson('.release-please-manifest.json'));
  const manifest = z
    .object({ version: semver })
    .parse(await readJson(`${pluginPath}/${manifestPath}`));
  const plainVersion = semver.parse(
    (await readFile(new URL(versionFile, root), 'utf8')).trim(),
  );
  assert.equal(manifest.version, versions[pluginPath]);
  assert.equal(plainVersion, manifest.version);
});

test('Renovate discovers the exact published runtime pin in the plugin launcher', async () => {
  const packageName = z
    .object({ name: z.string() })
    .parse(await readJson('package.json')).name;
  const renovate = z
    .object({
      enabledManagers: z.array(z.string()),
      customManagers: z.array(
        z.object({
          customType: z.string(),
          depNameTemplate: z.string(),
          datasourceTemplate: z.string(),
          managerFilePatterns: z.array(z.string()),
          matchStrings: z.array(z.string()),
        }),
      ),
    })
    .parse(await readJson('renovate.json'));
  assert.ok(renovate.enabledManagers.includes('custom.regex'));
  const manager = renovate.customManagers.find(
    (entry) =>
      entry.customType === 'regex' &&
      entry.depNameTemplate === packageName &&
      entry.datasourceTemplate === 'npm',
  );
  assert.ok(manager, 'the plugin runtime must follow published npm versions');
  const launcherPath = `${pluginPath}/start.sh`;
  assert.ok(
    manager.managerFilePatterns.some((pattern) => {
      assert.ok(pattern.startsWith('/') && pattern.endsWith('/'));
      return new RegExp(pattern.slice(1, -1)).test(launcherPath);
    }),
    'the manager must include the plugin launcher',
  );
  const launcher = await readFile(new URL(launcherPath, root), 'utf8');
  const pins = manager.matchStrings.flatMap((pattern) =>
    [...launcher.matchAll(new RegExp(pattern, 'g'))].map((match) =>
      semver.parse(match.groups?.currentValue),
    ),
  );
  assert.equal(pins.length, 1, 'exactly one runtime version must be updatable');
});
