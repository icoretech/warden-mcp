import { spawnSync } from 'node:child_process';

import { resolveBundledBwBin } from '../bw/resolveBwBin.js';

type BwProbeResult = { error?: Error | null };
type BwProbe = (
  command: string,
  args: string[],
  options: { encoding: string },
) => BwProbeResult;

export interface BwStartupDeps {
  resolveBundledBwBin?: () => string | null;
  probeSystemBw?: BwProbe;
  warn?: (message: string) => void;
}

export function prepareBwStartup(
  env: NodeJS.ProcessEnv = process.env,
  deps: BwStartupDeps = {},
): void {
  if (!env.BW_BIN) {
    const resolveBundled = deps.resolveBundledBwBin ?? resolveBundledBwBin;
    const candidate = resolveBundled();
    if (candidate) {
      env.BW_BIN = candidate;
      return;
    }
  }

  if (env.BW_BIN) return;

  const probe = (deps.probeSystemBw ?? spawnSync)('bw', ['--version'], {
    encoding: 'utf8',
  });
  if (!probe.error) return;

  const warn = deps.warn ?? console.warn;
  warn(
    '[warden-mcp] WARNING: bw CLI not found.\n' +
      'Install it with:  npm install -g @bitwarden/cli\n' +
      'Or set the BW_BIN environment variable to the path of the bw binary.\n' +
      'The server will start but tool calls will fail until bw is available.',
  );
}
