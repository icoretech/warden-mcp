# Optional SDK session management

`BwSessionManager` accepts an optional second argument for applications that
embed the SDK. Existing environment/header parsing, MCP tools, persisted
sessions and background unlock behavior are unchanged by default. These
options are code-level hooks, not new MCP arguments or HTTP headers.

## On-demand credentials

Supply a stable profile identity and a `credentialProvider` to avoid retaining
the master password or API client secret in the manager's configuration:

```ts
import { BwSessionManager } from '@icoretech/warden-mcp/dist/bw/bwSession.js';
import { readCredentials } from './local-credential-store.js';

const manager = new BwSessionManager(
  {
    host: 'https://vault.example.test',
    homeDir: '/private/application/bw-profile',
    unlockIntervalSeconds: 300,
    login: { method: 'userpass', user: 'agent@example.test' },
  },
  {
    credentialProvider: readCredentials,
    persistSession: false,
  },
);
```

The application's `readCredentials()` must return a promise containing
`{ password, login }`, with the same login identity as the configured profile.
For user/password login, `login` contains `method: 'userpass'` and `user`.
For API-key login it contains `method: 'apikey'`, `clientId` and `clientSecret`;
`password` is still the master password used to unlock the vault.

The provider is called only for login/unlock attempts, not when constructing
the manager or reusing a valid session. It may be called more than once during
authentication recovery and must not depend on a single invocation. Changed
login identities, empty credentials and provider failures reject the operation
before those credentials are passed to the CLI. Provider error messages and
causes are replaced with a fixed error because they may contain secrets.

## Memory-only session mode

`persistSession: false` prevents reading and writing the manager's
`.warden-mcp-session.json` and disables background unlock and keepalive.
Explicit SDK operations can still unlock on demand. CLI profile/authentication
data remains on disk; this option only changes session-key persistence.

Use a dedicated `homeDir` for this mode. Selecting it does not retroactively
delete a session file created by an earlier persisted configuration. Use
`revoke()` to remove that file, or migrate to a fresh private profile.
Applications must implement their own idle timeout by calling `revoke()`.
This option does not provide an operating-system credential store or isolate
secrets from processes running with the same user's full permissions.

## Explicit revocation

`await manager.revoke()` waits for the manager's active operation, stops its
keepalive, clears its in-memory session and template cache, removes its
persisted key under the profile auth lock, and asks the CLI to lock.
Queued keepalive callbacks cannot unlock the manager again. A subsequent
explicit SDK call may authenticate using the configured credentials/provider.

CLI lock and persisted-key deletion failures are reported; the manager's
in-memory session has already been cleared in either case. Other processes
that have independently copied a session key are not revoked by this method.
