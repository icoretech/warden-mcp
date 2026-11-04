# SDK session management

`BwSessionManager` accepts optional credential and persistence settings for
applications that embed the SDK. Existing MCP configuration, tool arguments and
the default constructor behavior stay the same: credentials come from `BwEnv`,
session keys are cached on disk, and background session maintenance is available.

## on-demand credentials

Supply a stable `BwSessionConfig` and a `credentialProvider` when the application
owns credential lookup or an interactive unlock prompt:

```ts
import {
  BwSessionManager,
  type BwSessionConfig,
} from '@icoretech/warden-mcp/dist/bw/bwSession.js';
import { readMasterPassword } from './credentials.js';

const config: BwSessionConfig = {
  host: 'https://vault.example.com',
  login: { method: 'userpass', user: 'user@example.com' },
  homeDir: '/path/to/dedicated-profile',
  unlockIntervalSeconds: 300,
};

const manager = new BwSessionManager(config, {
  credentialProvider: async () => ({
    ...config,
    password: await readMasterPassword(),
  }),
  persistSession: false,
});

try {
  await manager.withSession((session) =>
    manager.runForSession(session, ['list', 'folders']),
  );
} finally {
  await manager.revoke();
}
```

The application implements `readMasterPassword`; no operating-system credential
store or UI is bundled. The provider returns a `BwEnv` or a promise for one. Its
host, login method and username or API client ID must match the original config.
For API-key login, the config contains `clientId`; the provider also supplies
`clientSecret` and the master password. Provider results cannot redirect profile
storage or replace the manager's scheduling settings.

The provider runs only when authentication needs fresh credentials, after valid
in-memory and permitted persisted sessions have been checked. Concurrent calls
on one manager share its authentication attempt. Unlock, login and recovery
retries within that attempt use one provider result. Later authentication
attempts request credentials again. Provider-backed managers disable background
authentication, so `status()` and `startKeepUnlocked()` never trigger a prompt.
Do not call the same manager recursively from its provider: authentication holds
the manager and profile locks while awaiting credentials.

The manager retains the provider and stable config. It does not cache the
provider's returned credentials. Supplying a full `BwEnv` alongside a provider
does not retain its original password or client secret. The provider and the
application remain responsible for their own references; JavaScript strings and
child-process memory cannot be securely erased. Provider failures and identity
mismatches throw `BwCredentialError` with a fixed message and no raw cause.

## session-key persistence

`persistSession` defaults to `true`. Set it to `false` with either constructor
mode to skip reading, writing and automatically deleting
`.bitwarden-cli/.warden-mcp-session.json`. A new manager then obtains its own
session rather than adopting an earlier manager's cached session key.
`status()` remains observational and keepalive does not authenticate in this
mode.

This option applies to the manager's raw session-key cache. The official CLI
still writes its profile, encrypted vault and authentication state under the
chosen `homeDir`. It does not make the entire Bitwarden CLI profile memory-only.
Selecting the option does not erase a session key written by an older process.
For migration, stop every owner of the old profile and explicitly call
`revoke()` before resuming work with the new policy, or use a new dedicated
profile directory.

## explicit revocation and profile ownership

Use a dedicated `homeDir` for each independently managed SDK profile. Managers
that share a directory share CLI state and, with default persistence, cached
session keys. The existing filesystem authentication lock coordinates local
processes using that profile; it is not distributed coordination for replicas.
Use separate writable profiles for separate replicas or lifecycle owners.

`revoke()` immediately stops keepalive and fences queued background work. It
waits for earlier work on that manager to finish, clears its session and template
caches, deletes the persisted session-key file even in non-persistent mode, and
requests `bw lock` under the profile authentication lock. Later `status()` calls
do not restart background authentication. A later explicit `withSession()` or
`getTemplateItem()` call may authenticate again.

Deletion and CLI-lock failures are reported as `BwSessionRevokeError` with
`failures` containing `cache` and/or `lock`. Both cleanup steps are attempted
when either fails. Failure to acquire the profile lock is reported as
`profile`; local session and template references are still cleared. Raw CLI or
filesystem errors are not attached to this error.

Revocation is local profile cleanup, not account-wide token revocation. It does
not log out the account or invalidate keys already retained by another manager,
process or remote server. Stop other profile owners when a complete local
shutdown is required. `runForSession()` and `getTemplateItemForSession()` are
low-level operations for callers that already own a session; use them inside
`withSession()` so the manager can serialize them with revocation. Retaining a
session string outside that callback transfers its lifetime to the caller.
