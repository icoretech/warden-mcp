// src/bw/bwCli.ts

import { spawn } from 'node:child_process';

export interface BwRunOptions {
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  timeoutMs?: number;
  noInteraction?: boolean;
}

export interface BwRunResult {
  stdout: string;
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

export async function runBw(
  args: string[],
  opts: BwRunOptions = {},
): Promise<BwRunResult> {
  const bwBin = process.env.BW_BIN ?? 'bw';
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

  function safeArg(a: string): string {
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

  const child = spawn(bwBin, finalArgs, {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  child.stdout.on('data', (d: Buffer) => stdoutChunks.push(d));
  child.stderr.on('data', (d: Buffer) => stderrChunks.push(d));

  if (opts.stdin !== undefined) {
    child.stdin.write(opts.stdin);
  }
  child.stdin.end();

  let timeout: NodeJS.Timeout | undefined;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      if (debug) {
        console.log(`[bw] timeout after ${timeoutMs}ms`);
      }
      reject(new Error(`bw command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const completed = new Promise<BwRunResult>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
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
      resolve({ stdout, stderr });
    });
  });

  return Promise.race([completed, timedOut]);
}
