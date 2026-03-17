// src/app.ts

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import { bwEnvFromExpressHeaders } from './bw/bwHeaders.js';
import { BwSessionPool } from './bw/bwPool.js';
import { KeychainSdk } from './sdk/keychainSdk.js';
import { registerTools } from './tools/registerTools.js';

export interface CreateKeychainAppOptions {
  appName?: string;
  toolPrefix?: string;
  bwHomeRoot?: string;
  sessionTtlMs?: number;
  sessionMaxCount?: number;
  sessionSweepIntervalMs?: number;
  maxHeapUsedBytesFuse?: number;
  metricsLogIntervalMs?: number;
}

export function createKeychainApp(opts: CreateKeychainAppOptions = {}) {
  const parsePositiveInt = (raw: string | undefined, fallback: number) => {
    const parsed = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  const parseNonNegativeInt = (raw: string | undefined, fallback: number) => {
    const parsed = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  const TOOL_PREFIX = opts.toolPrefix ?? process.env.TOOL_PREFIX ?? 'keychain';
  const APP_NAME =
    opts.appName ?? process.env.MCP_APP_NAME ?? `${TOOL_PREFIX}-mcp`;
  const sessionTtlMs =
    opts.sessionTtlMs ??
    parsePositiveInt(process.env.KEYCHAIN_SESSION_TTL_MS, 15 * 60 * 1000);
  const sessionMaxCount =
    opts.sessionMaxCount ??
    parsePositiveInt(process.env.KEYCHAIN_SESSION_MAX_COUNT, 32);
  const sessionSweepIntervalMs = Math.max(
    1_000,
    opts.sessionSweepIntervalMs ??
      parsePositiveInt(process.env.KEYCHAIN_SESSION_SWEEP_INTERVAL_MS, 60_000),
  );
  const maxHeapUsedBytesFuse =
    opts.maxHeapUsedBytesFuse ??
    (() => {
      const maxHeapUsedMb = parseNonNegativeInt(
        process.env.KEYCHAIN_MAX_HEAP_USED_MB,
        1536,
      );
      if (maxHeapUsedMb === 0) return Number.POSITIVE_INFINITY;
      return maxHeapUsedMb * 1024 * 1024;
    })();
  const metricsLogIntervalMs =
    opts.metricsLogIntervalMs ??
    parseNonNegativeInt(process.env.KEYCHAIN_METRICS_LOG_INTERVAL_MS, 0);

  const pool = new BwSessionPool({
    rootDir:
      opts.bwHomeRoot ??
      process.env.KEYCHAIN_BW_HOME_ROOT ??
      `${process.env.HOME ?? '/data'}/bw-profiles`,
  });

  function createMcpServer() {
    const server = new McpServer({ name: APP_NAME, version: '0.1.0' });
    registerTools(server, {
      getSdk: async (authInfo?: AuthInfo) => {
        const extra = authInfo?.extra as Record<string, unknown> | undefined;
        const bwEnvFromHeader = extra?.bwEnv;
        if (bwEnvFromHeader && typeof bwEnvFromHeader === 'object') {
          const bw = await pool.getOrCreate(bwEnvFromHeader);
          return new KeychainSdk(bw);
        }
        throw new Error(
          'Missing Bitwarden config headers. Provide X-BW-Host, X-BW-Password, and either (X-BW-ClientId + X-BW-ClientSecret) or X-BW-User.',
        );
      },
      toolPrefix: TOOL_PREFIX,
    });
    return server;
  }

  async function withBwHeaders(req: express.Request) {
    const bwEnv = bwEnvFromExpressHeaders(req);
    (req as unknown as { auth?: AuthInfo }).auth = bwEnv
      ? {
          token: 'x-bw-headers',
          clientId: 'x-bw-headers',
          scopes: [],
          extra: { bwEnv },
        }
      : undefined;
  }

  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.get('/healthz', (_req, res) => res.status(200).send('ok'));

  // Keep per-session transports and servers (Streamable HTTP stateful mode).
  const sessions = new Map<
    string,
    {
      transport: StreamableHTTPServerTransport;
      server: McpServer;
      createdAt: number;
      lastSeenAt: number;
    }
  >();
  const counters = {
    rejected_sessions_429: 0,
    rejected_sessions_503: 0,
    session_ttl_evictions: 0,
    sessions_created: 0,
    sessions_closed: 0,
  };

  const closeSession = (
    sid: string,
    reason: 'ttl' | 'close' | 'replacement' | 'error' = 'close',
  ) => {
    const existing = sessions.get(sid);
    if (!existing) return;
    sessions.delete(sid);
    counters.sessions_closed += 1;
    if (reason === 'ttl') counters.session_ttl_evictions += 1;
    existing.transport.onclose = undefined;
    queueMicrotask(() => {
      existing.server.close();
    });
  };

  const sweepSessions = () => {
    const now = Date.now();

    for (const [sid, entry] of sessions.entries()) {
      if (now - entry.lastSeenAt > sessionTtlMs) {
        closeSession(sid, 'ttl');
      }
    }
  };

  const trackSession = (
    sid: string,
    transport: StreamableHTTPServerTransport,
    server: McpServer,
  ) => {
    closeSession(sid, 'replacement');
    const now = Date.now();
    sessions.set(sid, { transport, server, createdAt: now, lastSeenAt: now });
    counters.sessions_created += 1;
    let closing = false;
    transport.onclose = () => {
      if (closing) return;
      closing = true;
      const current = sessions.get(sid);
      if (current && current.transport === transport) {
        sessions.delete(sid);
        counters.sessions_closed += 1;
      }
      queueMicrotask(() => {
        transport.onclose = undefined;
        server.close();
      });
    };
    sweepSessions();
  };

  const touchSession = (sid: string) => {
    const existing = sessions.get(sid);
    if (!existing) return;
    existing.lastSeenAt = Date.now();
  };

  const collectMetrics = () => {
    const memoryUsage = process.memoryUsage();
    const fuseTripped = memoryUsage.heapUsed >= maxHeapUsedBytesFuse;
    return {
      session: {
        active_sessions: sessions.size,
        max_sessions: sessionMaxCount,
        ttl_ms: sessionTtlMs,
      },
      counters: { ...counters },
      memory: {
        heap_used_bytes: memoryUsage.heapUsed,
        rss_bytes: memoryUsage.rss,
        max_heap_used_bytes_fuse: Number.isFinite(maxHeapUsedBytesFuse)
          ? maxHeapUsedBytesFuse
          : -1,
        fuse_tripped: fuseTripped,
      },
    };
  };

  const rejectIfSessionCapacityReached = (res: express.Response) => {
    if (sessions.size < sessionMaxCount) return false;
    counters.rejected_sessions_429 += 1;
    res
      .status(429)
      .setHeader('retry-after', '1')
      .json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message:
            'Too many active MCP sessions. Reuse an existing mcp-session-id or retry shortly.',
        },
        id: null,
      });
    return true;
  };

  const rejectIfMemoryFuseTripped = (res: express.Response) => {
    if (!Number.isFinite(maxHeapUsedBytesFuse)) return false;
    const heapUsed = process.memoryUsage().heapUsed;
    if (heapUsed < maxHeapUsedBytesFuse) return false;
    counters.rejected_sessions_503 += 1;
    res
      .status(503)
      .setHeader('retry-after', '2')
      .json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message:
            'Server under memory pressure. Reuse an existing mcp-session-id or retry shortly.',
        },
        id: null,
      });
    return true;
  };

  const sweepTimer = setInterval(() => {
    sweepSessions();
  }, sessionSweepIntervalMs);
  sweepTimer.unref?.();

  if (metricsLogIntervalMs > 0) {
    const metricsTimer = setInterval(() => {
      const metrics = collectMetrics();
      console.log(
        `[metrics] sessions=${metrics.session.active_sessions}/${metrics.session.max_sessions} heap_used=${metrics.memory.heap_used_bytes} rejected429=${metrics.counters.rejected_sessions_429} rejected503=${metrics.counters.rejected_sessions_503} ttl_evictions=${metrics.counters.session_ttl_evictions}`,
      );
    }, metricsLogIntervalMs);
    metricsTimer.unref?.();
  }

  app.get('/metricsz', (_req, res) => {
    res.status(200).json(collectMetrics());
  });

  app.all('/sse', async (req, res) => {
    sweepSessions();
    const debugHttp =
      (process.env.KEYCHAIN_DEBUG_HTTP ?? 'false').toLowerCase() === 'true';
    if (debugHttp) {
      const accept = req.header('accept');
      const ct = req.header('content-type');
      const sid = req.header('mcp-session-id');
      const proto = req.header('mcp-protocol-version');
      const hasBw =
        Boolean(req.header('x-bw-host')) ||
        Boolean(req.header('x-bw-user')) ||
        Boolean(req.header('x-bw-clientid'));
      const body = (req as { body?: unknown }).body;
      const bodyMethod =
        body && typeof body === 'object'
          ? String((body as Record<string, unknown>).method ?? '-')
          : '-';

      console.log(
        `[http] ${req.method} ${req.path} m=${bodyMethod} accept=${accept ?? '-'} ct=${ct ?? '-'} sid=${sid ? 'yes' : 'no'} proto=${proto ?? '-'} bw=${hasBw ? 'yes' : 'no'}`,
      );
      res.once('finish', () => {
        const rct = res.getHeader('content-type');
        console.log(
          `[http] -> ${res.statusCode} ct=${typeof rct === 'string' ? rct : '-'}`,
        );
      });
    }

    // Some MCP clients probe DELETE support and may behave poorly if the server
    // actually terminates sessions. We intentionally do not support DELETE here.
    if (req.method === 'DELETE') {
      res
        .status(405)
        .setHeader('allow', 'GET, POST')
        .json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Method not allowed.' },
          id: null,
        });
      return;
    }

    await withBwHeaders(req);

    const sessionIdHeader = req.headers['mcp-session-id'];
    const sessionId =
      typeof sessionIdHeader === 'string'
        ? sessionIdHeader
        : Array.isArray(sessionIdHeader)
          ? sessionIdHeader[0]
          : undefined;

    try {
      const body = (req as { body?: unknown }).body;
      const isInit = req.method === 'POST' && isInitializeRequest(body);

      // Reuse an existing session, or recover it if the client is holding a stale ID.
      if (sessionId) {
        const existing = sessions.get(sessionId);
        if (existing) {
          touchSession(sessionId);
          await existing.transport.handleRequest(
            req as unknown as IncomingMessage & { auth?: AuthInfo },
            res as unknown as ServerResponse,
            body,
          );
          return;
        }

        // If we got an initialize request with a client-supplied session id,
        // accept it (Codex tends to cache session ids across restarts).
        if (isInit) {
          if (rejectIfMemoryFuseTripped(res)) return;
          if (rejectIfSessionCapacityReached(res)) return;
          const server = createMcpServer();
          let transport: StreamableHTTPServerTransport;
          let sidForCleanup: string | undefined;
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => sessionId,
            enableJsonResponse: true,
            onsessioninitialized: (sid) => {
              sidForCleanup = sid;
              trackSession(sid, transport, server);
            },
          });
          try {
            await server.connect(transport);
            await transport.handleRequest(
              req as unknown as IncomingMessage & { auth?: AuthInfo },
              res as unknown as ServerResponse,
              body,
            );
          } catch (error) {
            if (sidForCleanup) {
              closeSession(sidForCleanup);
            } else {
              transport.onclose = undefined;
              queueMicrotask(() => {
                server.close();
              });
            }
            throw error;
          }
          return;
        }

        // For non-initialize requests with an unknown session id, create a new
        // session and treat it as already initialized (best-effort compatibility).
        if (rejectIfMemoryFuseTripped(res)) return;
        if (rejectIfSessionCapacityReached(res)) return;
        const server = createMcpServer();
        let transport: StreamableHTTPServerTransport;
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => sessionId,
          enableJsonResponse: true,
        });

        // Hack: the SDK transport enforces "initialized" before accepting any
        // stateful request. Codex may send tool calls with a cached session id
        // without re-running initialize after a server restart.
        type WebStandardTransportHack = {
          sessionId?: string;
          _initialized?: boolean;
        };
        const wtUnknown = (
          transport as unknown as { _webStandardTransport?: unknown }
        )._webStandardTransport;
        if (wtUnknown && typeof wtUnknown === 'object') {
          const wt = wtUnknown as WebStandardTransportHack;
          wt.sessionId = sessionId;
          wt._initialized = true;
        }

        trackSession(sessionId, transport, server);
        try {
          await server.connect(transport);
          await transport.handleRequest(
            req as unknown as IncomingMessage & { auth?: AuthInfo },
            res as unknown as ServerResponse,
            body,
          );
          touchSession(sessionId);
        } catch (error) {
          closeSession(sessionId, 'error');
          throw error;
        }
        return;
      }

      // Initialize a new session
      if (
        !sessionId &&
        req.method === 'POST' &&
        isInitializeRequest(req.body)
      ) {
        if (rejectIfMemoryFuseTripped(res)) return;
        if (rejectIfSessionCapacityReached(res)) return;
        const server = createMcpServer();
        let transport: StreamableHTTPServerTransport;
        let sidForCleanup: string | undefined;
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (sid) => {
            sidForCleanup = sid;
            trackSession(sid, transport, server);
          },
        });
        try {
          await server.connect(transport);
          await transport.handleRequest(
            req as unknown as IncomingMessage & { auth?: AuthInfo },
            res as unknown as ServerResponse,
            body,
          );
        } catch (error) {
          if (sidForCleanup) {
            closeSession(sidForCleanup, 'error');
          } else {
            transport.onclose = undefined;
            queueMicrotask(() => {
              server.close();
            });
          }
          throw error;
        }
        return;
      }

      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: null,
      });
    } catch {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  return app;
}
