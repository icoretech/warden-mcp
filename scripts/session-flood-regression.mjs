#!/usr/bin/env node

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const baseUrl = (process.env.KEYCHAIN_FLOOD_BASE_URL ?? 'http://127.0.0.1:3005')
  .trim()
  .replace(/\/+$/, '');
const sseUrl = `${baseUrl}/sse`;
const metricsUrl = process.env.KEYCHAIN_METRICS_URL ?? `${baseUrl}/metricsz`;
const requests = parsePositiveInt(process.env.KEYCHAIN_FLOOD_REQUESTS, 500);
const concurrency = parsePositiveInt(
  process.env.KEYCHAIN_FLOOD_CONCURRENCY,
  25,
);
const timeoutMs = parsePositiveInt(process.env.KEYCHAIN_FLOOD_TIMEOUT_MS, 5000);

let sent = 0;
const counts = new Map();
let requestErrors = 0;

const bump = (key) => {
  counts.set(key, (counts.get(key) ?? 0) + 1);
};

const initializePayload = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'session-flood-regression', version: '0.0.0' },
  },
});

const worker = async () => {
  for (;;) {
    const index = sent;
    if (index >= requests) return;
    sent += 1;

    try {
      const response = await fetch(sseUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        body: initializePayload,
        signal: AbortSignal.timeout(timeoutMs),
      });
      bump(String(response.status));
      await response.arrayBuffer();
    } catch (error) {
      requestErrors += 1;
      bump('ERR');
      if (process.env.KEYCHAIN_FLOOD_DEBUG === 'true') {
        console.error(`[session-flood] request failed: ${String(error)}`);
      }
    }
  }
};

await Promise.all(
  Array.from({ length: Math.min(concurrency, requests) }, () => worker()),
);

let metrics = null;
try {
  const response = await fetch(metricsUrl, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.ok) {
    metrics = await response.json();
  }
} catch {
  // Keep regression usable even if metrics endpoint is unavailable.
}

const statusCounts = Object.fromEntries(
  [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])),
);
const summary = {
  baseUrl,
  sseUrl,
  metricsUrl,
  requests,
  concurrency,
  timeoutMs,
  statusCounts,
  requestErrors,
  metrics,
};

console.log(JSON.stringify(summary, null, 2));

const successes =
  (counts.get('200') ?? 0) +
  (counts.get('429') ?? 0) +
  (counts.get('503') ?? 0);
const hasGuardrailStatuses =
  (counts.get('429') ?? 0) + (counts.get('503') ?? 0) > 0;
const hasUnexpectedStatuses = [...counts.keys()].some(
  (key) => !['200', '429', '503'].includes(key),
);

if (
  successes === 0 ||
  hasUnexpectedStatuses ||
  requestErrors > 0 ||
  !hasGuardrailStatuses
) {
  process.exit(1);
}
