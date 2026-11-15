# warden-mcp plugin privacy notice

Effective November 15, 2026. This notice covers the local Claude Code plugin
maintained in [warden-mcp](https://github.com/icoretech/warden-mcp), using the
package selected in the [launcher](.mcp.json) and its bundled Bitwarden CLI. It does
not replace the policies of your vault operator, Anthropic, npm, or another
service you choose to use.

Relevant third-party policies include [Anthropic](https://www.anthropic.com/legal/privacy),
[Bitwarden](https://bitwarden.com/privacy/) when using its services,
[npm](https://docs.npmjs.com/policies/privacy/), and
[Have I Been Pwned](https://haveibeenpwned.com/Privacy) for exposed-password checks.
For a self-hosted vault or a different registry or Send host, consult that
operator's policy. Business Claude accounts may also be governed by their
organization's agreement with Anthropic.

## Data the plugin handles

The plugin receives your configured vault URL, personal API client ID and secret,
and master password through the local MCP process environment. These values let
the official CLI authenticate and unlock the vault. Credentials and decrypted
content are present in process memory while needed; this is not an operating
system keychain integration.

Tool inputs and results can contain vault item names, usernames, email addresses,
URIs, notes, passwords, TOTP codes, identity or payment details, organization and
collection metadata, attachment bytes, and Send content. The exact data depends
on the tools called and the account's access. The MCP server processes tool
arguments and does not request your full conversation history.

The client receives tool results, including revealed secrets and downloaded
content, and may include them in conversations, model requests, logs, or saved
history under its own settings and policies. Redaction does not remove data that
has already been returned to a client.

## Where data goes

- The bundled CLI contacts the configured Vaultwarden or Bitwarden service to
  authenticate, synchronize, and perform requested operations. Vault item and
  file writes use the CLI's encryption and service APIs. The vault service may
  use separate storage endpoints for attachments and Sends and may record
  organization audit events.
- Send receipt contacts the HTTPS URL supplied in the tool call, which can be a
  different host from the configured vault. The supplied Send password and
  access link are processed by the CLI for that operation.
- `keychain_get_exposed` uses the CLI's Pwned Passwords range lookup. It sends the
  first five hexadecimal characters of a password's SHA-1 hash to
  `api.pwnedpasswords.com`, then compares the returned hash suffixes locally.
  That lookup does not send the plaintext password. This follows the pinned
  CLI's [audit implementation](https://github.com/bitwarden/clients/blob/cli-v2026.10.1/libs/common/src/services/audit.service.ts).
- `npx` contacts the configured npm registry when it needs to download the
  package. Normal network connection metadata is visible to services contacted
  from your machine.

Username generation is local; forwarded email-alias provider integrations are
not supported. The warden-mcp application has no analytics or advertising
integration and does not send vault data to a maintainer-operated backend. The
CLI, vault operator, package registry, and MCP client have their own networking
and data practices; this is not a promise that those services collect no data.

## Local storage and retention

The plugin stores profiles under `${CLAUDE_PLUGIN_DATA}/bw-profiles`, in separate
credential-derived directories. These contain the CLI's encrypted vault cache
and authentication state. warden-mcp also persists an unencrypted reusable
session key in `.bitwarden-cli/.warden-mcp-session.json` with owner-only `0600`
file permissions. Protect the whole profile directory and any backups of it.

Profiles have no fixed automatic deletion period. Disabling or stopping the
plugin does not delete them. To remove local state, stop all processes using the
plugin, remove its saved configuration through the host, and delete the plugin's
profile data. Local deletion does not revoke account credentials or erase remote
vault items, backups, or client conversation history; manage those separately.

Attachment and file-Send operations can create temporary plaintext files, which
the server removes in normal cleanup. Interrupted processes or operating-system
backups may retain copies. Memory and file deletion are not guaranteed secure
erasure. Debug logging is off in the plugin configuration; diagnostic output and
logs retained by the host are governed by the host's retention settings.

## Controls and limits

`read_only` defaults to `true` and blocks mutating MCP tools. `no_reveal` defaults
to `true` and suppresses supported secret fields even if a tool asks to reveal
them. When no-reveal is disabled, the affected tools still require `reveal: true`.

These controls do not restrict access to a selected subset of vault items.
Names, usernames, URIs, and other metadata remain visible. Attachment and Send
tools can return plaintext or file bytes without a reveal flag, including in
read-only mode. Use a dedicated vault account with limited access, and review
tool requests before authorizing them in your client.

For privacy questions about this plugin, use the
[project issue tracker](https://github.com/icoretech/warden-mcp/issues) without
including credentials or private vault content. Security vulnerabilities can be
reported through [private vulnerability reporting](https://github.com/icoretech/warden-mcp/security/advisories/new).
