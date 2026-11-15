# warden-mcp for Claude Code

Connect Claude Code to a vault you control through the official Bitwarden CLI.
Search items, inspect folders and collections, and retrieve credentials or manage
vault content when you enable the corresponding permissions. This plugin runs
the pinned `@icoretech/warden-mcp@0.2.73` package locally over stdio.

This is an independent integration maintained by
[iCoreTech](https://github.com/icoretech/warden-mcp), not an official Bitwarden or
Vaultwarden product. Vaultwarden is exercised in the project's integration
suite; official Bitwarden compatibility is intended but is not continuously
tested against a hosted Bitwarden account.

## Setup

You need Claude Code with plugin configuration support, Node.js 22.23.5,
npm 10.9.10, and a vault account with a personal API client ID, client secret,
and master password. Use a dedicated account with only the vault data the
assistant needs.

To load this plugin from a source checkout, record its absolute path from the
repository root, then launch Claude from a separate project directory:

```bash
plugin_dir="$PWD/plugins/warden-mcp"
(
  cd /path/to/your-project || exit
  claude --plugin-dir "$plugin_dir"
)
```

Replace `/path/to/your-project` with a project outside the warden-mcp checkout so
`npx` resolves the pinned published package instead of the checkout's private
local package.

Complete the plugin's configuration prompts:

| Setting           | Value                                                          |
| ----------------- | -------------------------------------------------------------- |
| `vault_url`       | Your vault's HTTPS origin, such as `https://vault.example.com` |
| `client_id`       | Your personal API client ID                                    |
| `client_secret`   | Your personal API client secret; marked sensitive              |
| `master_password` | Your vault master password; marked sensitive                   |
| `read_only`       | Defaults to `true`; hides and rejects mutating tools           |
| `no_reveal`       | Defaults to `true`; keeps supported secret fields redacted     |

Enter credentials through plugin configuration, not a conversation or a tracked
file. The host supplies them to the local server as environment variables. The
first launch may download the pinned package and its bundled CLI from npm. This
plugin does not provide a remotely hosted connector or an OAuth login service.

## Try it

- "Find the login for example.com and show its item ID, username, and URI."
- "List the folders and organization collections available in my vault."
- "Find the sample-app login and show its metadata with secret fields redacted."

For credential retrieval, disable `no_reveal` only when appropriate and explicitly
request the password or TOTP code; secret-returning tools require `reveal: true`.
To create, edit, move, restore, or delete vault content, disable `read_only` first.

**No-reveal is not a blanket content filter.** Attachment downloads and Send
tools can return file bytes or text without a reveal flag. Item names, usernames,
URIs, and other metadata are also visible. Only connect vault data you are
willing to share with the MCP client and its model provider.

## Data and storage

The local server and bundled CLI authenticate to your configured vault, read and
decrypt its content locally, and return tool results to Claude. Enabled writes
send item, attachment, or Send content to the vault service. Send receipt can
contact the HTTPS address supplied to that tool. The exposed-password tool uses
the CLI's Pwned Passwords range lookup; username generation runs locally.

Profiles live under `${CLAUDE_PLUGIN_DATA}/bw-profiles`. They include the CLI's
encrypted vault cache and authentication state, plus a raw reusable session key
stored with owner-only file permissions. Stopping or disabling the plugin does
not erase these files. Debug logging is disabled in the plugin configuration.
Read the [privacy notice](PRIVACY.md) before connecting a vault.

## Troubleshooting and review

- If startup fails, check that Claude Code can find Node.js and `npx`, and that
  every required setting is populated. Allow time for the first npm download.
- If authentication fails, verify the vault URL, personal API credentials, and
  master password. Do not post credentials or unredacted logs in an issue.
- If writes are unavailable or a password remains redacted, check `read_only`
  and `no_reveal`, then restart the plugin after changing its settings.

Reviewers can use the repository's local Vaultwarden fixture instead of a real
vault. With Docker Compose available, run these commands from the repository
root:

```bash
plugin_dir="$PWD/plugins/warden-mcp"
docker compose up -d vaultwarden vaultwarden-https
docker compose run --rm --build bootstrap
docker compose exec -T vaultwarden-https cat /data/caddy/pki/authorities/local/root.crt > tmp/vaultwarden-review-ca.crt
export NODE_EXTRA_CA_CERTS="$PWD/tmp/vaultwarden-review-ca.crt"
review_workdir="$(mktemp -d "${TMPDIR:-/tmp}/warden-mcp-review.XXXXXX")"
(
  cd "$review_workdir" || exit
  claude --plugin-dir "$plugin_dir"
)
```

The subshell launches Claude from a separate disposable workspace while keeping
the plugin and CA certificate paths absolute. The parent shell stays in the
repository for subsequent Docker Compose commands.

The bootstrap builds the current fixture image, creates the local test account,
and writes its personal API credentials to the gitignored
`tmp/vaultwarden-bootstrap/apikey.env`. In the plugin configuration prompts, use
`https://localhost:8443` for `vault_url`, the generated client ID and secret, and
the local fixture's master password from `.env.test`. Enter these values in the
configuration prompts without pasting them into a conversation.

`NODE_EXTRA_CA_CERTS` points to an absolute path containing the fixture's Caddy
CA certificate, so TLS verification stays enabled. Export it before launching
Claude Code. Keep generated fixture credentials local and use them only for this
test vault; do not reuse them for a real account or commit them. The
[testing guide](https://github.com/icoretech/warden-mcp/blob/main/agent-instructions/testing.md)
documents further fixture checks. Stop the local services with `docker compose
down` when review is complete.

Report bugs or configuration questions in the
[issue tracker](https://github.com/icoretech/warden-mcp/issues). Report security
issues through [private vulnerability reporting](https://github.com/icoretech/warden-mcp/security/advisories/new).
The plugin is distributed under the [MIT license](https://github.com/icoretech/warden-mcp/blob/main/LICENSE).
