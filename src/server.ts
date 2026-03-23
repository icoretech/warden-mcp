// src/server.ts

import { parseArgs } from 'node:util';
import { createKeychainApp } from './transports/http.js';
import { runStdioTransport } from './transports/stdio.js';

const { values } = parseArgs({
  options: {
    stdio: { type: 'boolean', default: false },
    http: { type: 'boolean', default: false },
  },
  strict: false,
});

const useStdio =
  values.stdio === true || process.env.WARDEN_MCP_STDIO === 'true';

async function main(): Promise<void> {
  if (useStdio) {
    await runStdioTransport();
    return;
  }

  const PORT = Number.parseInt(process.env.PORT ?? '3005', 10);
  const app = createKeychainApp();
  const server = app.listen(PORT, () => {
    console.log(`[warden-mcp] listening on http://localhost:${PORT}/sse`);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('close', resolve);
    server.once('error', reject);
  });
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
