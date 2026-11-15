#!/bin/sh
set -eu

: "${CLAUDE_PLUGIN_DATA:?Missing plugin data directory}"
: "${CLAUDE_PLUGIN_OPTION_VAULT_URL:?Missing vault URL}"
: "${CLAUDE_PLUGIN_OPTION_CLIENT_ID:?Missing API client ID}"
: "${CLAUDE_PLUGIN_OPTION_CLIENT_SECRET:?Missing API client secret}"
: "${CLAUDE_PLUGIN_OPTION_MASTER_PASSWORD:?Missing master password}"

READONLY=${CLAUDE_PLUGIN_OPTION_READ_ONLY:-true}
NOREVEAL=${CLAUDE_PLUGIN_OPTION_NO_REVEAL:-true}
case "$READONLY:$NOREVEAL" in
  true:true|true:false|false:true|false:false) ;;
  *) printf '%s\n' 'Read-only and no-reveal options must be true or false' >&2; exit 64 ;;
esac

export BW_HOST="$CLAUDE_PLUGIN_OPTION_VAULT_URL"
export BW_CLIENTID="$CLAUDE_PLUGIN_OPTION_CLIENT_ID"
export BW_CLIENTSECRET="$CLAUDE_PLUGIN_OPTION_CLIENT_SECRET"
export BW_PASSWORD="$CLAUDE_PLUGIN_OPTION_MASTER_PASSWORD"
export KEYCHAIN_BW_HOME_ROOT="$CLAUDE_PLUGIN_DATA/bw-profiles"
export READONLY NOREVEAL
export KEYCHAIN_READONLY="$READONLY"
export KEYCHAIN_NOREVEAL="$NOREVEAL"
export MCP_APP_NAME=warden-mcp TOOL_PREFIX=keychain
export KEYCHAIN_DEBUG_BW=false KEYCHAIN_DEBUG_HTTP=false

exec npx -y @icoretech/warden-mcp@0.2.74 --stdio
