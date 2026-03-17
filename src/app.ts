// src/app.ts
// Re-export HTTP transport for backward compatibility with existing imports.
export {
  type CreateKeychainAppOptions,
  createKeychainApp,
} from './transports/http.js';
