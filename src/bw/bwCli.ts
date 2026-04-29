// src/bw/bwCli.ts

import { spawn } from 'node:child_process';
import { resolveBundledBwBin } from './resolveBwBin.js';

export interface BwRunOptions {
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  timeoutMs?: number;
  noInteraction?: boolean;
}

export interface BwRunResult {
  stdout: string;
  stdoutBuffer?: Buffer;
  stderr: string;
}

export class BwCliError extends Error {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;

  constructor(
    message: string,
    opts: { exitCode: number; stdout: string; stderr: string },
  ) {
    super(message);
    this.name = 'BwCliError';
    this.exitCode = opts.exitCode;
    this.stdout = opts.stdout;
    this.stderr = opts.stderr;
  }
}

export function isBwAuthSessionInvalidError(error: unknown): boolean {
  if (!(error instanceof BwCliError)) return false;

  const combined = [error.stderr, error.stdout, error.message]
    .join('\n')
    .toLowerCase();

  if (
    /not found/.test(combined) ||
    /more than one result/.test(combined) ||
    /multiple results/.test(combined) ||
    /ambiguous/.test(combined) ||
    /invalid search/.test(combined) ||
    /could not connect/.test(combined) ||
    /connection/.test(combined) ||
    /network/.test(combined) ||
    /timeout/.test(combined) ||
    /timed out/.test(combined) ||
    /server error/.test(combined)
  ) {
    return false;
  }

  return (
    /invalid\s+(bw\s+)?session/.test(combined) ||
    /(bw\s+)?session\s+(is\s+)?invalid/.test(combined) ||
    /expired\s+(bw\s+)?session/.test(combined) ||
    /(bw\s+)?session\s+(has\s+)?expired/.test(combined) ||
    /not logged in/.test(combined) ||
    /not authenticated/.test(combined) ||
    /you are not authenticated/.test(combined) ||
    /vault is locked/.test(combined) ||
    /please unlock/.test(combined) ||
    /unlock your vault/.test(combined) ||
    /requires an unlocked vault/.test(combined)
  );
}

export async function runBw(
  args: string[],
  opts: BwRunOptions = {},
): Promise<BwRunResult> {
  const bwBin = process.env.BW_BIN ?? resolveBundledBwBin() ?? 'bw';
  // Ensure the CLI never blocks waiting for a prompt (e.g. master password).
  // This is critical for running as an MCP server / in test automation.
  const injectNoInteraction = opts.noInteraction ?? true;
  const finalArgs =
    injectNoInteraction && !args.includes('--nointeraction')
      ? ['--nointeraction', ...args]
      : args;
  const env: NodeJS.ProcessEnv = { ...process.env, ...(opts.env ?? {}) };
  const debug =
    (process.env.KEYCHAIN_DEBUG_BW ?? 'false').toLowerCase() === 'true';
  const startedAt = Date.now();

  function safeArg(a: string | undefined): string {
    if (typeof a !== 'string') return '<redacted>';
    // Avoid logging encoded JSON blobs (may contain secrets).
    if (a.length > 80) return '<redacted>';
    return a;
  }

  function safeRenderedArgs(argv: string[]): string {
    const out: string[] = [];
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === '--session') {
        out.push('--session');
        if (i + 1 < argv.length) {
          out.push('<redacted>');
          i++;
        }
        continue;
      }
      out.push(safeArg(a));
    }
    return out.join(' ');
  }

  if (debug) {
    const rendered = safeRenderedArgs(finalArgs);
    console.log(`[bw] start: ${bwBin} ${rendered}`);
  }

  const detached = process.platform !== 'win32';
  const child = spawn(bwBin, finalArgs, {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached,
  });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  child.stdout.on('data', (d: Buffer) => stdoutChunks.push(d));
  child.stderr.on('data', (d: Buffer) => stderrChunks.push(d));

  if (opts.stdin !== undefined) {
    child.stdin.write(opts.stdin);
  }
  child.stdin.end();

  const timeoutMs = opts.timeoutMs ?? 60_000;

  const killChildProcessTree = () => {
    if (typeof child.pid === 'number' && detached) {
      try {
        process.kill(-child.pid, 'SIGKILL');
        return;
      } catch {
        // Fallback to direct child kill below.
      }
    }

    try {
      child.kill('SIGKILL');
    } catch {
      // ignore
    }
  };

  return new Promise<BwRunResult>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      fn();
    };

    const timeout = setTimeout(() => {
      killChildProcessTree();
      if (debug) {
        console.log(`[bw] timeout after ${timeoutMs}ms`);
      }
      settle(() => {
        reject(new Error(`bw command timed out after ${timeoutMs}ms`));
      });
    }, timeoutMs);

    child.on('error', (error: NodeJS.ErrnoException) => {
      settle(() => {
        const safeCmd = `${bwBin} ${safeRenderedArgs(finalArgs)}`;
        if (error.code === 'ENOENT') {
          reject(
            new Error(
              `bw CLI not available for ${safeCmd}. Install @bitwarden/cli or set BW_BIN to a valid bw binary.`,
            ),
          );
          return;
        }
        reject(new Error(`Failed to start ${safeCmd}: ${error.message}`));
      });
    });
    child.on('close', (code) => {
      settle(() => {
        const stdout = Buffer.concat(stdoutChunks).toString('utf8');
        const stderr = Buffer.concat(stderrChunks).toString('utf8');
        const exitCode = code ?? 1;
        if (exitCode !== 0) {
          if (debug) {
            console.log(
              `[bw] fail: exit=${exitCode} ms=${Date.now() - startedAt}`,
            );
          }
          const safeCmd = `${bwBin} ${safeRenderedArgs(finalArgs)}`;
          reject(
            new BwCliError(`${safeCmd} failed with exit code ${exitCode}`, {
              exitCode,
              stdout,
              stderr,
            }),
          );
          return;
        }
        if (debug) {
          console.log(`[bw] ok: ms=${Date.now() - startedAt}`);
        }
        resolve({ stdout, stdoutBuffer: Buffer.concat(stdoutChunks), stderr });
      });
    });
  });
}
