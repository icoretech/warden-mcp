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

if (useStdio) {
  await runStdioTransport();
} else {
  const PORT = Number.parseInt(process.env.PORT ?? '3005', 10);
  const app = createKeychainApp();
  app.listen(PORT, () => {
    console.log(`[warden-mcp] listening on http://localhost:${PORT}/sse`);
  });
}
