import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

function readJson(path: string) {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), path), 'utf8'),
  ) as Record<string, unknown>;
}

function readText(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function extractPlaywrightImageVersion(path: string) {
  const match = readText(path).match(
    /image:\s*mcr\.microsoft\.com\/playwright:v([^\s]+)-jammy/,
  );
  assert.ok(match, `missing Playwright image tag in ${path}`);
  return match[1];
}

test('renovate tracks playwright compose images from the npm package', () => {
  const renovate = readJson('renovate.json');
  const enabledManagers = renovate.enabledManagers;
  const customManagers = renovate.customManagers;
  const packageRules = renovate.packageRules;

  assert.ok(Array.isArray(enabledManagers), 'enabledManagers must be an array');
  assert.ok(enabledManagers.includes('custom.regex'));
  assert.ok(enabledManagers.includes('docker-compose'));
  assert.ok(
    Array.isArray(customManagers),
    'renovate customManagers must be an array',
  );
  assert.ok(
    Array.isArray(packageRules),
    'renovate packageRules must be an array',
  );

  const playwrightManager = customManagers.find((manager) => {
    if (!manager || typeof manager !== 'object') return false;
    return (
      (manager as { description?: unknown }).description ===
      'Track Playwright compose bootstrap images from the npm package version'
    );
  }) as Record<string, unknown> | undefined;

  assert.ok(playwrightManager, 'missing Playwright custom manager');
  assert.equal(playwrightManager.depNameTemplate, 'playwright');
  assert.equal(playwrightManager.datasourceTemplate, 'npm');
  assert.equal(playwrightManager.versioningTemplate, 'npm');
  assert.equal(
    playwrightManager.autoReplaceStringTemplate,
    'image: mcr.microsoft.com/playwright:v{{{newValue}}}-jammy',
  );
  assert.deepEqual(playwrightManager.managerFilePatterns, [
    '/^docker-compose(\\.org)?\\.yml$/',
  ]);

  const matchStrings = playwrightManager.matchStrings;
  assert.ok(Array.isArray(matchStrings), 'Playwright manager needs a regex');
  const imagePattern = new RegExp(matchStrings[0]);
  for (const path of ['docker-compose.yml', 'docker-compose.org.yml']) {
    const match = readText(path).match(imagePattern);
    assert.equal(
      match?.groups?.currentValue,
      extractPlaywrightImageVersion(path),
      `Playwright custom manager must match ${path}`,
    );
  }

  const playwrightRule = packageRules.find((rule) => {
    if (!rule || typeof rule !== 'object') return false;
    const packageNames = (rule as { matchPackageNames?: unknown })
      .matchPackageNames;
    return Array.isArray(packageNames) && packageNames.includes('playwright');
  }) as { groupSlug?: unknown; matchManagers?: unknown } | undefined;

  assert.ok(playwrightRule, 'missing shared renovate rule for Playwright');
  assert.equal(playwrightRule.groupSlug, 'playwright-tooling');
  assert.deepEqual(playwrightRule.matchManagers, ['custom.regex', 'npm']);
});

test('renovate disables docker-only playwright image updates', () => {
  const renovate = readJson('renovate.json');
  const packageRules = renovate.packageRules;

  assert.ok(
    Array.isArray(packageRules),
    'renovate packageRules must be an array',
  );

  const dockerOnlyRule = packageRules.find((rule) => {
    if (!rule || typeof rule !== 'object') return false;
    const packageNames = (rule as { matchPackageNames?: unknown })
      .matchPackageNames;
    return (
      Array.isArray(packageNames) &&
      packageNames.includes('mcr.microsoft.com/playwright')
    );
  }) as
    | {
        enabled?: unknown;
        matchDatasources?: unknown;
        matchManagers?: unknown;
      }
    | undefined;

  assert.ok(dockerOnlyRule, 'missing Docker-only Playwright disable rule');
  assert.equal(dockerOnlyRule.enabled, false);
  assert.deepEqual(dockerOnlyRule.matchManagers, ['docker-compose']);
  assert.deepEqual(dockerOnlyRule.matchDatasources, ['docker']);
});

test('compose bootstrap images stay aligned with the package playwright version', () => {
  const packageJson = readJson('package.json') as {
    devDependencies?: Record<string, string>;
  };
  const expectedVersion = packageJson.devDependencies?.playwright;

  assert.ok(
    expectedVersion,
    'package.json must declare a playwright devDependency',
  );
  assert.equal(
    extractPlaywrightImageVersion('docker-compose.yml'),
    expectedVersion,
  );
  assert.equal(
    extractPlaywrightImageVersion('docker-compose.org.yml'),
    expectedVersion,
  );
});
