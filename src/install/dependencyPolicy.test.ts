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

test('renovate groups playwright npm and compose image updates', () => {
  const renovate = readJson('renovate.json');
  const enabledManagers = renovate.enabledManagers;
  const packageRules = renovate.packageRules;

  assert.ok(Array.isArray(enabledManagers), 'enabledManagers must be an array');
  assert.ok(enabledManagers.includes('docker-compose'));
  assert.ok(
    Array.isArray(packageRules),
    'renovate packageRules must be an array',
  );

  const playwrightRule = packageRules.find((rule) => {
    if (!rule || typeof rule !== 'object') return false;
    const packageNames = (rule as { matchPackageNames?: unknown })
      .matchPackageNames;
    return (
      Array.isArray(packageNames) &&
      packageNames.includes('playwright') &&
      packageNames.includes('mcr.microsoft.com/playwright')
    );
  }) as { groupSlug?: unknown } | undefined;

  assert.ok(playwrightRule, 'missing shared renovate rule for Playwright');
  assert.equal(playwrightRule.groupSlug, 'playwright-tooling');
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
