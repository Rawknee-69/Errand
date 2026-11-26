#!/usr/bin/env bash
# Ticket 22 native proof driver. The machine has no Docker engine, so the same
# sources run as four native processes; BASE goes through Caddy. The shared
# probe covers routing, login, the connector and the journal; this script adds
# the replica restore and plaintext scan.
set -euo pipefail

STACK="${STACK:?set STACK to the native stack directory}"
export BASE="${BASE:-http://localhost:8088}"
if [ -z "${OWNER_PASSPHRASE:-}" ]; then
  echo "set OWNER_PASSPHRASE to the owner login" >&2
  exit 1
fi
export OWNER_PASSPHRASE
export CONNECTOR_URL="${CONNECTOR_URL:-http://127.0.0.1:8790/mcp}"
export KEY_OUT="$STACK/agent-key.txt"
export LITESTREAM_DATABASE_PATH="${LITESTREAM_DATABASE_PATH:-$STACK/data/errand.db}"
export LITESTREAM_META_PATH="${LITESTREAM_META_PATH:-$STACK/meta/errand.db}"
export LITESTREAM_REPLICA_PATH="${LITESTREAM_REPLICA_PATH:-$STACK/replica/errand.db}"

bash scripts/probe-stack.sh
KEY="$(cat "$KEY_OUT")"

LITESTREAM_BIN="${LITESTREAM_BIN:-litestream}"
# Litestream syncs L0 frames once a second; let the journal write land first.
sleep 5
"$LITESTREAM_BIN" restore -config deploy/litestream.yml -force \
  -o "$STACK/restored.db" "$LITESTREAM_DATABASE_PATH" >/dev/null
[ -s "$STACK/restored.db" ] || { echo "FAIL: the replica did not restore" >&2; exit 1; }

grep -qF -- "connector.connected" "$STACK/restored.db" \
  || { echo "FAIL: positive control failed" >&2; exit 1; }
! grep -qF -- "$KEY" "$STACK/restored.db" \
  || { echo "FAIL: the credential is plaintext in the replica" >&2; exit 1; }
! grep -qF -- "$(cat "$STACK/vault-key.txt")" "$STACK/restored.db" \
  || { echo "FAIL: the KEK is in the replica" >&2; exit 1; }

echo "ok: the restored replica holds the credential only as ciphertext and the KEK nowhere"
echo "native stack probe passed"
