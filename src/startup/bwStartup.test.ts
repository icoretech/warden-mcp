import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareBwStartup } from './bwStartup.js';

test('prepareBwStartup prefers bundled bw when available', () => {
  const env: NodeJS.ProcessEnv = {};

  prepareBwStartup(env, {
    resolveBundledBwBin: () => '/tmp/bundled-bw',
    probeSystemBw: () => {
      throw new Error('system probe should not run when bundled bw exists');
    },
  });

  assert.equal(env.BW_BIN, '/tmp/bundled-bw');
});

test('prepareBwStartup does not probe or warn when BW_BIN is already set', () => {
  const env: NodeJS.ProcessEnv = { BW_BIN: '/tmp/custom-bw' };
  let warned = false;

  prepareBwStartup(env, {
    resolveBundledBwBin: () => {
      throw new Error('bundled resolution should not run when BW_BIN is set');
    },
    probeSystemBw: () => {
      throw new Error('system probe should not run when BW_BIN is set');
    },
    warn: () => {
      warned = true;
    },
  });

  assert.equal(env.BW_BIN, '/tmp/custom-bw');
  assert.equal(warned, false);
});

test('prepareBwStartup warns without throwing when bw is unavailable', () => {
  const env: NodeJS.ProcessEnv = {};
  let warning = '';
  const missingBwProbe = () => ({
    error: Object.assign(new Error('spawn bw ENOENT'), { code: 'ENOENT' }),
  });

  prepareBwStartup(env, {
    resolveBundledBwBin: () => null,
    probeSystemBw: missingBwProbe,
    warn: (message) => {
      warning = message;
    },
  });

  assert.equal(env.BW_BIN, undefined);
  assert.match(warning, /WARNING: bw CLI not found/);
  assert.match(warning, /tool calls will fail until bw is available/);
});
