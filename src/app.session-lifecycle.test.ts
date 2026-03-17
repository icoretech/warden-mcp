import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createKeychainApp } from './app.js';

async function initializeOverSse(baseUrl: string, sessionId?: string) {
  const headers: Record<string, string> = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;

  const res = await fetch(`${baseUrl}/sse`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'session-lifecycle-test', version: '0.0.0' },
      },
    }),
  });

  return {
    status: res.status,
    sessionId: res.headers.get('mcp-session-id'),
  };
}

async function getMetrics(baseUrl: string) {
  const res = await fetch(`${baseUrl}/metricsz`);
  assert.equal(res.status, 200);
  return (await res.json()) as {
    session: {
      active_sessions: number;
      max_sessions: number;
      ttl_ms: number;
    };
    counters: {
      rejected_sessions_429: number;
      rejected_sessions_503: number;
      session_ttl_evictions: number;
      sessions_created: number;
      sessions_closed: number;
    };
    memory: {
      heap_used_bytes: number;
      rss_bytes: number;
      max_heap_used_bytes_fuse: number;
      fuse_tripped: boolean;
    };
  };
}

test('rejects new sessions when max session count is reached', async () => {
  const bwHomeRoot = await mkdtemp(join(tmpdir(), 'keychain-session-max-'));
  const app = createKeychainApp({
    bwHomeRoot,
    sessionMaxCount: 2,
    sessionTtlMs: 500,
    sessionSweepIntervalMs: 60_000,
  });
  const httpServer = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => httpServer.once('listening', resolve));

  try {
    const addr = httpServer.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Unexpected server address');
    }
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const first = await initializeOverSse(baseUrl);
    const second = await initializeOverSse(baseUrl);
    const third = await initializeOverSse(baseUrl);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(third.status, 429);
    assert.ok(first.sessionId);

    // Existing sessions still behave normally.
    const firstAgain = await initializeOverSse(baseUrl, first.sessionId ?? '');
    assert.equal(firstAgain.status, 400);

    // After ttl expiry, capacity is freed and new sessions are accepted again.
    await new Promise((resolve) => setTimeout(resolve, 650));
    const afterTtl = await initializeOverSse(baseUrl);
    assert.equal(afterTtl.status, 200);
  } finally {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await rm(bwHomeRoot, { recursive: true, force: true });
  }
});

test('expires idle sessions after ttl', async () => {
  const bwHomeRoot = await mkdtemp(join(tmpdir(), 'keychain-session-ttl-'));
  const app = createKeychainApp({
    bwHomeRoot,
    sessionMaxCount: 128,
    sessionTtlMs: 25,
    sessionSweepIntervalMs: 60_000,
  });
  const httpServer = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => httpServer.once('listening', resolve));

  try {
    const addr = httpServer.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Unexpected server address');
    }
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const initial = await initializeOverSse(baseUrl);
    assert.equal(initial.status, 200);
    assert.ok(initial.sessionId);

    const immediate = await initializeOverSse(baseUrl, initial.sessionId ?? '');
    assert.equal(immediate.status, 400);

    await new Promise((resolve) => setTimeout(resolve, 60));
    const afterTtl = await initializeOverSse(baseUrl, initial.sessionId ?? '');
    assert.equal(afterTtl.status, 200);
  } finally {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await rm(bwHomeRoot, { recursive: true, force: true });
  }
});

test('metricsz reports session counters and ttl evictions', async () => {
  const bwHomeRoot = await mkdtemp(join(tmpdir(), 'keychain-session-metrics-'));
  const app = createKeychainApp({
    bwHomeRoot,
    sessionMaxCount: 1,
    sessionTtlMs: 20,
    sessionSweepIntervalMs: 10,
  });
  const httpServer = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => httpServer.once('listening', resolve));

  try {
    const addr = httpServer.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Unexpected server address');
    }
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const first = await initializeOverSse(baseUrl);
    const second = await initializeOverSse(baseUrl);
    assert.equal(first.status, 200);
    assert.equal(second.status, 429);

    await new Promise((resolve) => setTimeout(resolve, 50));
    const retry = await initializeOverSse(baseUrl, first.sessionId ?? '');
    assert.equal(retry.status, 200);

    const metrics = await getMetrics(baseUrl);
    assert.equal(metrics.counters.rejected_sessions_429, 1);
    assert.ok(metrics.counters.session_ttl_evictions >= 1);
    assert.equal(metrics.session.max_sessions, 1);
  } finally {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await rm(bwHomeRoot, { recursive: true, force: true });
  }
});

test('memory fuse rejects new sessions with 503', async () => {
  const bwHomeRoot = await mkdtemp(join(tmpdir(), 'keychain-session-fuse-'));
  const app = createKeychainApp({
    bwHomeRoot,
    // Force fuse to trip in-process for deterministic tests.
    maxHeapUsedBytesFuse: 1,
  });
  const httpServer = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => httpServer.once('listening', resolve));

  try {
    const addr = httpServer.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Unexpected server address');
    }
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const init = await initializeOverSse(baseUrl);
    assert.equal(init.status, 503);

    const metrics = await getMetrics(baseUrl);
    assert.equal(metrics.counters.rejected_sessions_503, 1);
    assert.equal(metrics.memory.fuse_tripped, true);
  } finally {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await rm(bwHomeRoot, { recursive: true, force: true });
  }
});
