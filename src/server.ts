import { createKeychainApp } from './app.js';

const PORT = Number.parseInt(process.env.PORT ?? '3005', 10);
// HTTP server (Streamable HTTP + SSE)
const app = createKeychainApp();

app.listen(PORT, () => {
  console.log(`[keychain-mcp] listening on http://localhost:${PORT}/sse`);
});
